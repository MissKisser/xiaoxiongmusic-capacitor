/**
 * 解锁歌曲 URL 结果
 */
export interface SongUrlResult {
    /** 状态码：200 成功，404 失败 */
    code: number;
    /** 歌曲播放 URL */
    url: string | null;
}
