# Водоеми БГ – данни за язовирите

`dams.json` – запълненост на 52-та комплексни и значими язовира в България,
взета автоматично от **Ежедневния бюлетин за състоянието на водите** на
[МОСВ](https://www.moew.government.bg/bg/prescentur/byuletini-na-nkc-kum-mosv/vodi/) (данните са към 8 ч. на деня).

Ползва се от Android приложението „Водоеми БГ“:
`https://raw.githubusercontent.com/icaka0710-creator/vodoemibg-data/main/dams.json`

Обновява се от GitHub Actions всеки час през деня (`.github/workflows/update.yml`),
записва се само при нов бюлетин. История – последните 60 бюлетина за всеки язовир.

Полета: `pct` – % от общия обем, `usefulPct` – % от полезния обем, `availableMm3` /
`totalMm3` – млн. м³, `inflow` / `outflow` – м³/сек, `trend` – up / down / steady / overflow.
