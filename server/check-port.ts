/**
 * 检查端口是否被占用
 */

import { createServer } from "net";

export const checkPort = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const server = createServer();
    
    server.listen(port, () => {
      server.once("close", () => {
        resolve(true); // 端口可用
      });
      server.close();
    });
    
    server.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        resolve(false); // 端口被占用
      } else {
        resolve(true); // 其他错误，假设可用
      }
    });
  });
};
