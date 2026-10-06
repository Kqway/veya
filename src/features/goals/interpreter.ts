import { goalSpecSchema, type GoalSpec, type Currency } from "./schema";
/** Local interpretation proposes capability, never evidence of success. Ambiguous
 * numbers/currencies are preserved as unsupported goals rather than guessed. */
export function interpretGoal(text: string): GoalSpec {
  const currencies: Currency[] = [];
  if (/\$|\bUSD\b|доллар/i.test(text)) currencies.push("USD");
  if (/€|\bEUR\b|евро/i.test(text)) currencies.push("EUR");
  if (/₽|\bRUB\b|руб|rou?bles?/i.test(text)) currencies.push("RUB");
  const currency = currencies[0] ?? "RUB";
  const numbers = [...text.matchAll(/\d[\d\s\u00a0.,]*/g)].map((match) =>
    match[0].trim(),
  );
  const number = numbers[0] ?? "";
  const validFormat =
    /^(?:\d+|\d{1,3}(?:[ \u00a0]\d{3})+)(?:[.,]\d{1,2})?$/.test(number);
  const [whole, fraction = ""] = number
    .replace(/[\s\u00a0]/g, "")
    .replace(",", ".")
    .split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  const negative = /[-−]\s*[$€₽]?\s*\d/.test(text);
  const unsupportedCurrency =
    /£|¥|\b(?:GBP|JPY|CNY|CHF|BTC|USDT|INR|KZT|BYN|AED|CAD|AUD|NZD|SEK|NOK|DKK|PLN|TRY|BRL|MXN|HKD|SGD|ZAR|KRW)\b/i.test(
      text,
    );
  const supported =
    /заработ|earn|make\s+\$|доход/i.test(text) &&
    numbers.length === 1 &&
    currencies.length <= 1 &&
    !negative &&
    !unsupportedCurrency &&
    validFormat &&
    Number.isSafeInteger(amount) &&
    amount > 0 &&
    amount <= 100000000;
  // Person searches require a real owner seeking post; never infer availability.
  const earning = /заработ|earn|доход/i.test(text);
  const activity = /фотограф|photographer/i.test(text)
    ? "photography"
    : /дизайнер|designer/i.test(text)
      ? "design"
      : /шахмат|chess/i.test(text)
        ? "chess"
        : null;
  const people =
    !earning && /найди|найти|find|ищу/i.test(text) && activity !== null;
  return goalSpecSchema.parse({
    type: supported ? "earn_money" : people ? "find_people" : "unsupported",
    targetAmountMinor: supported ? amount : 0,
    currency,
    successCriteria: supported
      ? ["Подтверждённая оплата в валюте цели"]
      : ["Нужна доступная возможность выполнения"],
    constraints: { maxSpendMinor: 0 },
    needs: supported
      ? ["Заказ на документ или исследование"]
      : people
        ? [activity!]
        : [],
    offers: supported ? ["Подготовка и проверка документа"] : [],
    valueExchange: supported
      ? "Проверенный документ в обмен на демонстрационную оплату"
      : "Возможность пока не подключена",
  });
}
