/**
 * 解锁歌曲 URL 结果
 */
export interface SongUrlResult {
    /** 状态码：200 成功，404 失败 */
    code: number;
    /** 歌曲播放 URL */
    url: string | null;
    /**
     * 失败原因（用户可读）
     *
     * 仅失败时给出，供上层展示可读文案（如远程源暂不可用、服务端未匹配到候选）。
     */
    reason?: string;
    /**
     * 直链体积校验是否已完成
     *
     * 为 false 时表示体积探测失败或缺少可比对的时长，直链未经体积校验。
     */
    lengthVerified?: boolean;
    /**
     * 胜出候选的元数据时长（秒）
     *
     * 供胜者终审比对同名异版：元数据时长与目标曲偏差超过终审容差时，
     * 追加直链真实音频时长探测后决定放行或拒绝。
     */
    matchedDuration?: number;
}
