import { t } from "./i18n";
import { systemProxy } from "./tauri";

/**
 * 下载失败时要不要多说一句 —— 取决于探没探到代理。
 *
 * 三个分支，只有中间那个该说话：
 *   探到了     → 不说。代理明明在用还说"没检测到"，会把人支到完全错误的方向。
 *   没探到     → 说。这是用户自己能解决的那一种失败（把 VPN 切到系统代理模式）。
 *   问不出来   → 不说。浏览器构建里没有 Tauri，老版本的壳没注册这个命令 —— 那时
 *                断言"没有代理"和断言"有代理"一样，都是在编造我们不知道的事实。
 */
export const downloadHint = async (): Promise<string> => {
  const proxy = await systemProxy().catch(() => "unknown");
  return proxy === null ? t("setVoiceNoProxy") : "";
};
