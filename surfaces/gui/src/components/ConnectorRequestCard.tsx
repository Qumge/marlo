import { useState } from "react";
import type { Item } from "../types";
import { useT } from "../i18n";
import { Icon } from "./Icon";

type ConnReqItem = Extract<Item, { kind: "connreq" }>;

// Marlo 在对话里要一个账号的授权（request_connector）。形状跟着
// DirectoryRequestCard 走 —— 用户已经认得那张卡，换个说法只会让人多想一次。
//
// 这张卡片是用户交出邮箱访问权之前看到的最后一屏，所以有三条硬要求：
//
//  1. 说清楚要连什么、为什么。reason 是模型给的一句话，直接引出来。
//  2. 有中转方就写出来，没有就【不写】。一键连接的 token 由 OpenWorker Cloud
//     经手，用户点之前该知道；而本机直连的连接器没有第三方——凭空说"由 X
//     中转"是自己制造一个不信任的理由。
//  3. 拒绝和同意一样容易找到。
export function ConnectorRequestCard({
  item,
  onRespond,
}: {
  item: ConnReqItem;
  onRespond: (connect: boolean) => void;
}) {
  const t = useT();
  // 浏览器要开、OAuth 要走，中间有几秒到几十秒。按钮不变态的话用户会以为
  // 没反应然后再点一次 —— 那会开出第二个授权流程。
  const [waiting, setWaiting] = useState(false);

  return (
    <div className="connreq-card" data-testid="connector-request">
      <div className="connreq-head">
        <Icon name="plug" size={16} className="ico" />
        <span>{t("connectRequestTitle")(item.title || item.connector)}</span>
      </div>
      {item.reason && <div className="connreq-reason">“{item.reason}”</div>}
      {item.brokered_by && (
        <div className="connreq-broker" data-testid="connector-broker">
          {t("connectBrokeredBy")(item.brokered_by)}
        </div>
      )}
      {item.user_code && (
        // 自家服务的设备码。把码印在卡片上，用户在浏览器打开的页面里核对
        // 同一串 —— 这一步是防"点开的是另一个授权请求"的唯一手段。
        <div className="connreq-code" data-testid="connector-user-code">
          {item.user_code}
        </div>
      )}
      <div className="connreq-actions">
        <span className="spacer" />
        <button className="btn" data-testid="connector-decline" onClick={() => onRespond(false)}>
          {t("notNow")}
        </button>
        <button
          className="btn primary"
          data-testid="connector-connect"
          disabled={waiting}
          onClick={() => {
            setWaiting(true);
            onRespond(true);
          }}
        >
          {waiting ? t("checkYourBrowser") : t("connectNow")}
        </button>
      </div>
    </div>
  );
}
