/**
 * 酷狗音乐设备注册与指纹管理
 *
 * @author Hackerdallas
 */

import { getKgAppid, getKgClientver, KG_ANDROID_UA } from "./config";
import {
  decryptKugouDeviceData,
  encryptKugouDeviceData,
  getDeviceMid,
  rsaEncryptKugouPkcs1,
  signatureAndroidParams,
} from "./crypto";
import { getSessionCookies, saveSessionCookies } from "../../sessionStore";
import { platformRequest } from "../../http";

let registering: Promise<string> | null = null;

/**
 * 生成符合 UUID v4 规范的随机标识
 * @returns UUID 字符串
 */
const generateGuid = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * 注册设备并获取设备指纹 dfid
 * @returns 设备指纹 dfid
 */
const registerDevice = async (): Promise<string> => {
  const session = getSessionCookies("kugou");
  const guid = session.guid || generateGuid();
  const encrypted = encryptKugouDeviceData({
    availableRamSize: 4983533568,
    availableRomSize: 48114719,
    availableSDSize: 48114717,
    basebandVer: "",
    batteryLevel: 100,
    batteryStatus: 3,
    brand: "Redmi",
    buildSerial: "unknown",
    device: "marble",
    imei: guid,
    imsi: "",
    manufacturer: "Xiaomi",
    uuid: guid,
    accelerometer: false,
    accelerometerValue: "",
    gravity: false,
    gravityValue: "",
    gyroscope: false,
    gyroscopeValue: "",
    light: false,
    lightValue: "",
    magnetic: false,
    magneticValue: "",
    orientation: false,
    orientationValue: "",
    pressure: false,
    pressureValue: "",
    step_counter: false,
    step_counterValue: "",
    temperature: false,
    temperatureValue: "",
  });

  const clienttime = Math.floor(Date.now() / 1000);
  const params: Record<string, unknown> = {
    dfid: "-",
    mid: getDeviceMid(),
    uuid: "-",
    appid: getKgAppid(),
    clientver: getKgClientver(),
    clienttime,
    part: 1,
    platid: 1,
    p: rsaEncryptKugouPkcs1({
      aes: encrypted.key,
      uid: Number(session.userid || 0),
      token: session.token || "",
    }),
  };

  params.signature = signatureAndroidParams(params, encrypted.content);

  const queryParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      queryParams[key] = String(value);
    }
  }

  const response = await platformRequest({
    url: "https://userservice.kugou.com/risk/v2/r_register_dev",
    method: "POST",
    params: queryParams,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": KG_ANDROID_UA,
      dfid: "-",
      mid: getDeviceMid(),
      clienttime: String(clienttime),
    },
    data: encrypted.content,
    timeout: 8000,
    responseType: "arraybuffer",
  });

  if (response.status !== 200) {
    throw new Error(`KG register device HTTP ${response.status}`);
  }

  const rawBytes =
    response.data instanceof ArrayBuffer
      ? new Uint8Array(response.data)
      : typeof response.data === "string"
        ? response.data
        : new Uint8Array(0);

  const result = decryptKugouDeviceData(rawBytes, encrypted.key) as {
    status?: number;
    data?: { dfid?: string };
  };

  const dfid = result?.data?.dfid;
  if (result?.status !== 1 || !dfid) {
    throw new Error("KG register device failed");
  }

  saveSessionCookies("kugou", { ...session, guid, dfid });
  return dfid;
};

/**
 * 确保酷狗会话中具有可用的设备指纹 dfid
 * @returns 设备指纹 dfid
 */
export const ensureKugouDfid = async (): Promise<string> => {
  const current = getSessionCookies("kugou").dfid;
  if (current) return current;
  registering ??= registerDevice().finally(() => {
    registering = null;
  });
  return await registering;
};
