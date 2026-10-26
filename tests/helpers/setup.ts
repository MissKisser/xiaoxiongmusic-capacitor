/**
 * 测试环境前置桩（DOM / LocalStorage / Window 兼容层）
 *
 * 为 Node.js 单测环境注入最小化全局对象，确保依赖浏览器特性的模块可被安全载入。
 *
 * @author Hackerdallas
 */

import * as Vue from "vue";

// 将 Vue 常用导出挂载至 globalThis，对齐 Vite unplugin-auto-import 行为
for (const [key, value] of Object.entries(Vue)) {
  if (typeof (globalThis as unknown as Record<string, unknown>)[key] === "undefined") {
    (globalThis as unknown as Record<string, unknown>)[key] = value;
  }
}

if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, val: string): void => {
      store.set(key, String(val));
      mockStorage.length = store.size;
    },
    removeItem: (key: string): void => {
      store.delete(key);
      mockStorage.length = store.size;
    },
    clear: (): void => {
      store.clear();
      mockStorage.length = 0;
    },
    key: (index: number): string | null => Array.from(store.keys())[index] ?? null,
    length: 0,
  };
  (globalThis as unknown as { localStorage: Storage }).localStorage = mockStorage as unknown as Storage;
}

if (typeof globalThis.sessionStorage === "undefined") {
  const store = new Map<string, string>();
  const mockSessionStorage = {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, val: string): void => {
      store.set(key, String(val));
      mockSessionStorage.length = store.size;
    },
    removeItem: (key: string): void => {
      store.delete(key);
      mockSessionStorage.length = store.size;
    },
    clear: (): void => {
      store.clear();
      mockSessionStorage.length = 0;
    },
    key: (index: number): string | null => Array.from(store.keys())[index] ?? null,
    length: 0,
  };
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = mockSessionStorage as unknown as Storage;
}

if (typeof (globalThis as unknown as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: unknown }).window = globalThis;
}

if (typeof (globalThis as unknown as { self?: unknown }).self === "undefined") {
  (globalThis as unknown as { self: unknown }).self = globalThis;
}

if (typeof (globalThis as unknown as { location?: unknown }).location === "undefined") {
  (globalThis as unknown as { location: unknown }).location = {
    href: "http://localhost/",
    origin: "http://localhost",
    protocol: "http:",
    host: "localhost",
    hostname: "localhost",
    pathname: "/",
    search: "",
    hash: "",
  };
}

if (typeof (globalThis as unknown as { document?: unknown }).document === "undefined") {
  (globalThis as unknown as { document: unknown }).document = {
    fonts: { ready: Promise.resolve() },
    createElement: () => ({ style: {} }),
    getElementById: () => null,
    querySelector: () => null,
  };
}

if (typeof (globalThis as unknown as { Image?: unknown }).Image === "undefined") {
  (globalThis as unknown as { Image: unknown }).Image = class MockImage {};
}
