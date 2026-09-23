import { useTranslation } from "react-i18next";
import { QumgeConnect } from "../providers/QumgeConnect";

// 没登录就按了发送：在输入框上方就地登录，而不是被带去一整页服务商设置（owner 2026-09-23）。
//
// 小白看到「22 家服务商 + API key」会直接卡死；他要的只是「让它开始干活」。Qumge 一键登录
// 之后模型和技能都有了，刚才那句话留在输入框里，登录好自动发出去（Composer 的 effect）。
// 自带密钥的人还有一条小路，但不抢主路。
export function SignInPrompt({
  onConnected,
  onUseOwnKey,
}: {
  onConnected: () => void;
  onUseOwnKey: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="dirreq-card mb-2" data-testid="signin-prompt">
      <div className="dirreq-head">
        <span>{t("signin.head")}</span>
      </div>
      <div className="toolreq-facts">
        <div className="toolreq-explain">{t("signin.body")}</div>
      </div>
      <div className="mt-3">
        <QumgeConnect onConnected={onConnected} />
      </div>
      <div className="dirreq-actions">
        <span className="spacer" />
        <button className="text-meta text-faint underline hover:text-muted" data-testid="signin-own-key" onClick={onUseOwnKey}>
          {t("signin.own_key")}
        </button>
      </div>
    </div>
  );
}
