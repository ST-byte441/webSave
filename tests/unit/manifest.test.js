import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));

describe('manifest', () => {
  it('is a Manifest V3 extension with the spec permissions', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'tabs', 'storage']);
    expect(manifest.minimum_chrome_version).toBe('112');
    expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.background).toBeUndefined();
    expect(manifest.browser_specific_settings.gecko.strict_min_version).toBe('128.0');
  });

  it('references files that exist', () => {
    for (const file of [manifest.action.default_popup, 'capture/capture.html', 'vendor/browser-polyfill.js', 'vendor/Readability.js']) {
      expect(existsSync(`extension/${file}`), file).toBe(true);
    }
  });
});
