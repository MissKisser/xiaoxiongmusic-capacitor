/**
 * 下载变体项定义
 */
export interface DownloadAsset {
  variant: string;
  url: string;
}

/**
 * 提取默认下载变体的真实地址
 *
 * @param assets 下载变体列表
 * @returns 默认变体下载地址，若无则返回空字符串
 */
export const pickDefaultAssetUrl = (assets?: DownloadAsset[] | null): string => {
  if (!Array.isArray(assets)) {
    return '';
  }
  const item = assets.find((asset) => asset?.variant === 'default');
  return item?.url || '';
};
