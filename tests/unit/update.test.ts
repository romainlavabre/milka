import { describe, expect, it } from 'vitest'
import { INSTALL_SCRIPT_URL, appImageInstallDir, isNewer, pickAsset, terminalArgs, updateCommand } from '../../src/main/update'

const asset = (name: string) => ({ name, browser_download_url: `https://example.com/${name}` })

describe('update', () => {
  it('compares versions number by number', () => {
    expect(isNewer('1.2.10', '1.2.9')).toBe(true)
    expect(isNewer('2.0.0', '1.9.9')).toBe(true)
    expect(isNewer('1.2.0', '1.2.0')).toBe(false)
    expect(isNewer('1.1.9', '1.2.0')).toBe(false)
    expect(isNewer('v1.3.0', '1.2.0')).toBe(true)
    // Anything that is not X.Y.Z is never an update.
    expect(isNewer('nightly', '1.2.0')).toBe(false)
    expect(isNewer('1.3.0-beta', '1.2.0')).toBe(false)
  })

  it('picks the package of the install kind with the highest version', () => {
    const assets = [
      asset('milka-1.2.9-amd64.deb'),
      asset('milka-1.2.10-amd64.deb'),
      asset('milka-1.2.10-x86_64.AppImage'),
      asset('milka-cli-1.2.10.cjs')
    ]
    expect(pickAsset(assets, 'deb')?.name).toBe('milka-1.2.10-amd64.deb')
    expect(pickAsset(assets, 'appimage')?.name).toBe('milka-1.2.10-x86_64.AppImage')
    expect(pickAsset([asset('milka-cli-1.2.10.cjs')], 'deb')).toBeNull()
  })

  it('updates an AppImage install as an AppImage, even on Debian', () => {
    expect(updateCommand('deb')).toBe(`curl -fsSL ${INSTALL_SCRIPT_URL} | bash`)
    expect(updateCommand('unknown')).toBe(`curl -fsSL ${INSTALL_SCRIPT_URL} | bash`)
    expect(updateCommand('appimage')).toBe(`curl -fsSL ${INSTALL_SCRIPT_URL} | bash -s -- --appimage`)
    expect(appImageInstallDir({ XDG_DATA_HOME: '/data' })).toBe('/data/milka/app')
  })

  it('passes the command to each terminal as an argument, never inside the script', () => {
    const command = updateCommand('deb')
    expect(terminalArgs('gnome-terminal', command).slice(0, 3)).toEqual(['--', 'bash', '-c'])
    expect(terminalArgs('konsole', command).slice(0, 2)).toEqual(['-e', 'bash'])
    expect(terminalArgs('kitty', command)[0]).toBe('bash')
    expect(terminalArgs('wezterm', command).slice(0, 3)).toEqual(['start', '--', 'bash'])
    const args = terminalArgs('xterm', command)
    expect(args.slice(-2)).toEqual(['milka-update', command])
    expect(args[3]).not.toContain('curl')
  })
})
