import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickDefaultAssetUrl, type DownloadAsset } from '../src/utils/updateAssets';
import { escapeHtml, renderMarkdown } from '../src/utils/renderMarkdown';

describe('安卓端变体取址', () => {
  it('取 default 变体地址', () => {
    const assets: DownloadAsset[] = [{ variant: 'default', url: 'https://x/a.apk' }];
    assert.equal(pickDefaultAssetUrl(assets), 'https://x/a.apk');
  });

  it('无 default 时返回空串', () => {
    const assets: DownloadAsset[] = [{ variant: 'portable', url: 'https://x/p.exe' }];
    assert.equal(pickDefaultAssetUrl(assets), '');
  });

  it('assets 为 undefined、null、空数组时返回空字符串', () => {
    assert.equal(pickDefaultAssetUrl(undefined), '');
    assert.equal(pickDefaultAssetUrl(null), '');
    assert.equal(pickDefaultAssetUrl([]), '');
  });

  it('数组含空元素时仍能取到 default 变体地址且不抛错', () => {
    const assetsWithNulls = [
      null,
      undefined,
      { variant: 'default', url: 'https://x/a.apk' },
    ] as unknown as DownloadAsset[];
    assert.equal(pickDefaultAssetUrl(assetsWithNulls), 'https://x/a.apk');
  });

  it('变体项 url 为空字符串时返回空字符串', () => {
    const assets: DownloadAsset[] = [{ variant: 'default', url: '' }];
    assert.equal(pickDefaultAssetUrl(assets), '');
  });
});

describe('更新说明渲染', () => {
  it('转义原始 HTML 关键字符', () => {
    assert.equal(escapeHtml('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
    assert.equal(escapeHtml('a & b > c'), 'a &amp; b &gt; c');
  });

  it('对含 script 标签的输入转义危险标签并保留粗体样式', () => {
    const rendered = renderMarkdown('**更新内容**<script>alert(1)</script>');
    assert.ok(rendered.includes('<strong>更新内容</strong>'));
    assert.ok(rendered.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!rendered.includes('<script>'));
  });
});
