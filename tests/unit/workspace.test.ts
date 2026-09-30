import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkspaceRepo } from '@shared/types'
import type { WorkspaceManager } from '../../src/main/workspace/manager'
import { bareRemote, git, tempRoot, user } from './helpers'

let root: string
let remote: string

beforeEach(() => {
  root = tempRoot('milka-ws-')
  remote = bareRemote(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Writes one file through the manager, as a content service does. */
function writeNote(ws: WorkspaceManager, repo: WorkspaceRepo, name: string, content: string): Promise<void> {
  return ws.change(repo, () => {
    writeFileSync(join(repo.path, 'collections', name), content)
    return { result: undefined, paths: [`collections/${name}`], message: `Update note "${name}"` }
  })
}

describe('WorkspaceManager', () => {
  it('shares files between two clones', async () => {
    const alice = user(root, 'alice')
    const repo = await alice.ws.clone('Client A', remote)
    expect(JSON.parse(readFileSync(join(repo.path, 'milka.json'), 'utf8'))).toEqual({ name: 'Client A', formatVersion: 1 })
    await writeNote(alice.ws, repo, 'a.txt', 'hello')
    await alice.ws.flush()

    const bob = user(root, 'bob')
    const bobRepo = await bob.ws.clone('Client A', remote)
    expect(readFileSync(join(bobRepo.path, 'collections/a.txt'), 'utf8')).toBe('hello')
    expect(git(remote, 'log', '--format=%s', 'master').trim().split('\n')).toEqual(['Update note "a.txt"', 'Initialize workspace'])
  })

  it('switches between workspaces and removes them', async () => {
    const { ws } = user(root, 'alice')
    const a = await ws.create('Client A')
    const b = await ws.create('Client B')
    expect(ws.state().activeRepoId).toBe(b.id)
    await ws.activate(a.id)
    expect(ws.active().name).toBe('Client A')
    ws.remove(a.id, true)
    expect(existsSync(a.path)).toBe(false)
    expect(ws.state()).toMatchObject({ activeRepoId: b.id, repos: [{ name: 'Client B' }] })
  })

  it('has no limit on the number of workspaces', async () => {
    const { ws } = user(root, 'alice')
    for (let i = 1; i <= 5; i++) await ws.create(`Workspace ${i}`)
    expect(ws.state().repos).toHaveLength(5)
  })

  it('reports conflicts and resolves them with the chosen side', async () => {
    const alice = user(root, 'alice')
    const aliceRepo = await alice.ws.clone('Shared', remote)
    await writeNote(alice.ws, aliceRepo, 'q.txt', 'first')
    await alice.ws.flush()

    const bob = user(root, 'bob')
    const bobRepo = await bob.ws.clone('Shared', remote)
    await bob.ws.flush()

    await writeNote(alice.ws, aliceRepo, 'q.txt', 'alice')
    await alice.ws.flush()

    await writeNote(bob.ws, bobRepo, 'q.txt', 'bob')
    await bob.ws.flush()
    const status = await bob.ws.sync(bobRepo.id)
    expect(status.conflicts).toEqual(['collections/q.txt'])
    // The failed rebase was aborted: Bob's version is still there.
    expect(readFileSync(join(bobRepo.path, 'collections/q.txt'), 'utf8')).toBe('bob')

    const resolved = await bob.ws.resolveConflicts(bobRepo.id, { 'collections/q.txt': 'theirs' })
    expect(resolved.conflicts).toEqual([])
    expect(resolved.error).toBeNull()
    expect(readFileSync(join(bobRepo.path, 'collections/q.txt'), 'utf8')).toBe('alice')
    expect(git(bobRepo.path, 'status', '--porcelain')).toBe('')
  })

  it('commits files edited outside the app on sync', async () => {
    const { ws } = user(root, 'alice')
    const repo = await ws.clone('Shared', remote)
    await ws.flush()
    writeFileSync(join(repo.path, 'collections', 'manual.yaml'), 'name: x\n')
    const status = await ws.sync(repo.id)
    expect(status).toMatchObject({ dirty: false, ahead: 0, error: null })
    expect(git(remote, 'log', '--format=%s', 'master')).toContain('Update workspace')
  })

  it('always works on master, even when the remote default branch is main', async () => {
    const mainRemote = bareRemote(root, 'main-remote.git', 'main')
    const seed = join(root, 'seed')
    execFileSync('git', ['clone', mainRemote, seed])
    writeFileSync(join(seed, 'README.md'), 'hello\n')
    git(seed, 'add', '.')
    git(seed, 'commit', '-m', 'Initial commit')
    git(seed, 'push', 'origin', 'main')

    const { ws } = user(root, 'alice')
    const repo = await ws.clone('GitHub', mainRemote)
    await writeNote(ws, repo, 'n.txt', 'x')
    await ws.flush()
    expect(git(repo.path, 'branch', '--show-current').trim()).toBe('master')
    expect(git(mainRemote, 'log', '--format=%s', 'master')).toContain('Update note "n.txt"')
    expect(git(mainRemote, 'log', '--format=%s', 'master')).toContain('Initial commit')
    expect(git(mainRemote, 'log', '--format=%s', 'main').trim()).toBe('Initial commit')
  })

  it('refuses to clone into a non-empty folder', async () => {
    const { ws } = user(root, 'alice')
    const target = join(root, 'busy')
    execFileSync('mkdir', [target])
    writeFileSync(join(target, 'x'), '')
    await expect(ws.clone('X', remote, target)).rejects.toThrow(/not empty/)
  })
})
