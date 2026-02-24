/**
 * 简单存储模块（不依赖 Electron）
 */

import { defaultAMLLDbServer } from "./config.js";

// 简单的内存存储
const memoryStore: Record<string, any> = {
  amllDbServer: defaultAMLLDbServer,
};

export const useStore = () => {
  return {
    get: <T = any>(key: string, defaultValue?: T): T => {
      return (memoryStore[key] ?? defaultValue) as T;
    },
    set: (key: string, value: any): void => {
      memoryStore[key] = value;
    },
    has: (key: string): boolean => {
      return key in memoryStore;
    },
    delete: (key: string): void => {
      delete memoryStore[key];
    },
    clear: (): void => {
      Object.keys(memoryStore).forEach((key) => {
        if (key !== "amllDbServer") {
          delete memoryStore[key];
        }
      });
    },
  };
};
