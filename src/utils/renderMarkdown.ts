import { marked } from 'marked';

/**
 * 转义文本中的关键 HTML 特殊字符
 *
 * @param text 待转义的原始文本
 * @returns 转义后的安全文本
 */
export function escapeHtml(text: string): string {
  if (!text) {
    return '';
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 将 Markdown 文本安全渲染为 HTML 字符串
 *
 * @param markdown 待渲染的 Markdown 源文本
 * @returns 渲染生成的 HTML 字符串
 */
export function renderMarkdown(markdown: string): string {
  if (!markdown) {
    return '';
  }
  const escaped = escapeHtml(markdown);
  return marked.parse(escaped, { breaks: true, gfm: true }) as string;
}
