import { useTranslation } from "react-i18next";
import type { SkillOfferItem } from "../cardPayloads";
import { Icon } from "./Icon";

// Marlo 缺一个技能时先问用户要不要装（owner 2026-09-23）。
//
// 用户平时是跟 Marlo 说话，这张卡是那一下「授权」：一句是非问句，读出来也成立。
// 按钮之外，用户直接说「装吧」「先不用」也算回答（App.send → replyIntent）。
//
// 标题和理由是模型用用户的话写的；目录里的 id（pptx / xlsx）和英文简介一个字都不上屏。
export function SkillOfferCard({
  item,
  onRespond,
}: {
  item: SkillOfferItem;
  onRespond: (approved: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="dirreq-card" data-testid="skilloffer-card">
      <div className="dirreq-head">
        <Icon name="sparkle" size={16} className="ico" />
        <span>{t("skilloffer.head")}</span>
      </div>
      <div className="toolreq-facts">
        <div className="toolreq-factrow">
          <span className="toolreq-label" data-testid="skilloffer-title">{item.title}</span>
        </div>
        {item.why && <div className="toolreq-explain">{item.why}</div>}
        <div className="toolreq-explain">{t("skilloffer.from")}</div>
      </div>
      <div className="dirreq-actions">
        <span className="text-meta text-faint">{t("skilloffer.voice_hint")}</span>
        <span className="spacer" />
        <button className="btn" data-testid="skilloffer-skip" onClick={() => onRespond(false)}>
          {t("skilloffer.skip")}
        </button>
        <button className="btn primary" data-testid="skilloffer-install" onClick={() => onRespond(true)}>
          {t("skilloffer.install")}
        </button>
      </div>
    </div>
  );
}
