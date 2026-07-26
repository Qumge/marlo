import { getLocale, setLocale, useT, type Locale } from "../i18n";

// Two entry points, deliberately.
//
// Settings is where a preference belongs, but someone who downloaded from a
// Chinese page and got an English window needs to fix it before they know the
// app has a Settings tab — so onboarding carries one too. `compact` is that one:
// no label, no explanation, just the switch.
//
// Styled with the existing `.seg` segmented control rather than a new pair of
// classes. This codebase already lints for card/button sprawl elsewhere; a
// language switch is not a reason to start a thirty-seventh variant.
const OPTIONS: Locale[] = ["en", "zh"];

export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const current = getLocale();

  const buttons = (
    <div className="seg" role="group" aria-label={t("language")}>
      {OPTIONS.map((loc) => (
        <button
          key={loc}
          type="button"
          className={loc === current ? "active" : undefined}
          aria-pressed={loc === current}
          data-testid={`lang-${loc}`}
          onClick={() => setLocale(loc)}
        >
          {loc === "en" ? t("langEnglish") : t("langChinese")}
        </button>
      ))}
    </div>
  );

  if (compact) return buttons;

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-[13px]">{t("language")}</div>
        <div className="text-[12px] text-muted">{t("languageSub")}</div>
      </div>
      {buttons}
    </div>
  );
}
