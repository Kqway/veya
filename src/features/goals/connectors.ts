import "server-only";
import { createHash } from "node:crypto";
import type { DatabaseExecutor } from "@/lib/db/types";
import { opaqueKey } from "@/features/social/pairs";
import type { Currency } from "./schema";
import type { GoalRow } from "./repository";
import { confirmedAmount } from "./repository";
import { artifactStorage, type ArtifactStorage } from "./storage";
import { evidenceSchema, type ToolName } from "./tools";
export interface PaymentEvidence {
  providerEventId: string;
  invoiceKey: string;
  amountMinor: number;
  currency: Currency;
}
export interface PaymentWebhookAdapter {
  authenticate(
    rawBody: string,
    signature: string,
  ): Promise<PaymentEvidence | null>;
}
export interface OpportunityCandidate {
  catalogKey: string;
  title: string;
  kind: "document" | "code";
  complexity: number;
  maxAmountMinor: number;
  currencies: readonly Currency[];
  spendMinor: number;
  requirements: readonly string[];
}
export interface OpportunityConnector {
  readonly id: "mock";
  readonly transactional: true;
  search(input: {
    currency: Currency;
    amountMinor: number;
    maxSpendMinor: 0;
  }): readonly OpportunityCandidate[];
  readRequirements(candidate: OpportunityCandidate): readonly string[];
}
export interface ClientConnector {
  acceptProposal(): { accepted: boolean; evidence: string };
  reviewDelivery(revision: number): { accepted: boolean; feedback: string };
}
export class MockClient implements ClientConnector {
  acceptProposal() {
    return {
      accepted: true,
      evidence: "Демонстрационный клиент принял предложение",
    };
  }
  reviewDelivery(revision: number) {
    return {
      accepted: revision > 0,
      feedback:
        revision > 0
          ? "Клиент принял обновлённый документ"
          : "Добавьте пошаговый план внедрения",
    };
  }
}
export interface PaymentProvider {
  createInvoice(): string;
  getStatus(
    invoiceKey: string,
    amountMinor: number,
    currency: Currency,
  ): PaymentEvidence;
}
export class MockPaymentProvider implements PaymentProvider {
  createInvoice() {
    return opaqueKey();
  }
  getStatus(
    invoiceKey: string,
    amountMinor: number,
    currency: Currency,
  ): PaymentEvidence {
    return {
      providerEventId: "mock:" + invoiceKey,
      invoiceKey,
      amountMinor,
      currency,
    };
  }
}
const catalog: readonly OpportunityCandidate[] = [
  {
    catalogKey: "remote-work",
    title: "Обзор организации удалённой работы",
    kind: "document",
    complexity: 1,
    maxAmountMinor: 1000000,
    currencies: ["RUB", "USD", "EUR"],
    spendMinor: 0,
    requirements: ["Обзор", "Рекомендации", "Источники"],
  },
  {
    catalogKey: "large-market-research",
    title: "Большое рыночное исследование",
    kind: "document",
    complexity: 4,
    maxAmountMinor: 2000000,
    currencies: ["RUB", "USD", "EUR"],
    spendMinor: 0,
    requirements: ["Обзор", "Рекомендации", "Источники"],
  },
  {
    catalogKey: "paid-dataset",
    title: "Анализ платного набора данных",
    kind: "document",
    complexity: 2,
    maxAmountMinor: 1000000,
    currencies: ["RUB"],
    spendMinor: 1000,
    requirements: ["Обзор"],
  },
  {
    catalogKey: "code-project",
    title: "Разработка приложения",
    kind: "code",
    complexity: 2,
    maxAmountMinor: 1000000,
    currencies: ["RUB", "USD", "EUR"],
    spendMinor: 0,
    requirements: ["Сборка", "Тесты"],
  },
];
export interface MockObservation {
  next: ToolName;
  reference: string;
  description: string;
  wait?: boolean;
  revision?: number;
  paid?: boolean;
}
interface Deal {
  id: string;
  public_key: string;
  title: string;
  amount_minor: string;
  currency: Currency;
  revision: number;
  status: string;
  invoice_key: string | null;
}
/** Fixed catalog and deterministic client; external content never becomes instructions. */
export class MockOpportunityConnector implements OpportunityConnector {
  readonly id = "mock" as const;
  readonly transactional = true as const;
  constructor(
    private readonly storage?: ArtifactStorage,
    private readonly client: ClientConnector = new MockClient(),
    private readonly payments: PaymentProvider = new MockPaymentProvider(),
  ) {}
  search(input: { currency: Currency; amountMinor: number; maxSpendMinor: 0 }) {
    return catalog
      .slice(0, 5)
      .filter(
        (c) =>
          c.kind === "document" &&
          c.complexity <= 2 &&
          c.spendMinor <= input.maxSpendMinor &&
          c.currencies.includes(input.currency) &&
          c.maxAmountMinor >= input.amountMinor,
      )
      .sort((a, b) => a.complexity - b.complexity);
  }
  readRequirements(candidate: OpportunityCandidate) {
    return candidate.requirements;
  }

  async execute(
    tx: DatabaseExecutor,
    g: GoalRow,
    step: { id: string; actionKey: string },
  ): Promise<MockObservation> {
    const storage = this.storage ?? artifactStorage(tx);
    const tool = g.next_tool;
    if (tool === "search") {
      const amount = Math.min(
        1000000,
        Number(g.target_amount_minor) - (await confirmedAmount(tx, g.id)),
      );
      if (amount <= 0) throw new Error("Invalid outstanding amount");
      const candidates = this.search({
          currency: g.currency,
          amountMinor: amount,
          maxSpendMinor: 0,
        }),
        selected = candidates[0];
      if (!selected) throw new Error("No supported opportunity");
      const op = (
        await tx.query<{ public_key: string }>(
          `INSERT INTO agent_opportunities(public_key,goal_id,cycle,title,requirements,amount_minor,currency) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(goal_id,cycle) DO UPDATE SET goal_id=EXCLUDED.goal_id RETURNING public_key`,
          [
            opaqueKey(),
            g.id,
            g.cycle,
            selected.title,
            JSON.stringify(this.readRequirements(selected)),
            amount,
            g.currency,
          ],
        )
      ).rows[0]!;
      return this.observation(
        "requirements",
        op.public_key,
        "Проверены 4 тестовых заказа: исключены расходы, сложные и исполняемые работы. Выбран документ с проверяемыми требованиями",
      );
    }
    const opportunity = (
      await tx.query<{
        id: string;
        public_key: string;
        title: string;
        amount_minor: string;
        currency: Currency;
        requirements: string[];
      }>("SELECT * FROM agent_opportunities WHERE goal_id=$1 AND cycle=$2", [
        g.id,
        g.cycle,
      ])
    ).rows[0];
    if (!opportunity) throw new Error("Missing opportunity");
    if (tool === "requirements")
      return this.observation(
        "proposal",
        opportunity.public_key,
        "Изучены требования: обзор, рекомендации и источники; только текстовый документ",
      );
    if (tool === "proposal") {
      const d = (
        await tx.query<Deal>(
          `INSERT INTO agent_deals(public_key,goal_id,opportunity_id,cycle,title,amount_minor,currency,status) VALUES($1,$2,$3,$4,$5,$6,$7,'proposed') ON CONFLICT(goal_id,cycle) DO UPDATE SET goal_id=EXCLUDED.goal_id RETURNING *`,
          [
            opaqueKey(),
            g.id,
            opportunity.id,
            g.cycle,
            opportunity.title,
            opportunity.amount_minor,
            g.currency,
          ],
        )
      ).rows[0]!;
      const proposalKey = opaqueKey();
      await tx.query(
        `INSERT INTO agent_proposals(public_key,goal_id,deal_id,idempotency_key,status) VALUES($1,$2,$3,$4,'sent') ON CONFLICT(idempotency_key) DO NOTHING`,
        [proposalKey, g.id, d.id, step.actionKey],
      );
      return {
        ...this.observation(
          "client_response",
          proposalKey,
          "Предложение отправлено демонстрационному клиенту",
        ),
        wait: true,
      };
    }
    const d = (
      await tx.query<Deal>(
        "SELECT * FROM agent_deals WHERE goal_id=$1 AND cycle=$2 FOR UPDATE",
        [g.id, g.cycle],
      )
    ).rows[0];
    if (!d) throw new Error("Missing deal");
    const message = async (kind: string, description: string) => {
      const key = opaqueKey();
      await tx.query(
        "INSERT INTO agent_conversations(public_key,goal_id,deal_id,kind,description,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(idempotency_key) DO NOTHING",
        [key, g.id, d.id, kind, description, step.actionKey],
      );
      return key;
    };
    if (tool === "client_response") {
      await tx.query("UPDATE agent_deals SET status='accepted' WHERE id=$1", [
        d.id,
      ]);
      await tx.query(
        "UPDATE agent_proposals SET status='accepted' WHERE deal_id=$1",
        [d.id],
      );
      return this.observation(
        "create_artifact",
        await message("acceptance", this.client.acceptProposal().evidence),
        "Клиент принял предложение и подтвердил требования",
      );
    }
    if (tool === "create_artifact" || tool === "revise_artifact") {
      const revision = tool === "revise_artifact" ? g.revision + 1 : g.revision;
      if (revision > 3) throw new Error("Revision budget exceeded");
      const content = `# Организация удалённой работы\n\nДемонстрационный исследовательский документ. Содержимое подготовлено локально, без внешнего поиска.\n\n## Обзор\nУдалённая команда согласует цели, рабочие часы и способы документирования решений. Для небольших команд полезен общий журнал задач и регулярная короткая встреча.\n\n## Рекомендации\n1. Зафиксировать результат каждой задачи и ответственного.\n2. Публиковать решения в общем документе.\n3. Раз в неделю проверять сроки и препятствия.\n\n## Источники\nТребования демонстрационного клиента и фиксированный локальный каталог Veya. Внешние исследования не проводились.\n${revision ? "\n## План внедрения\nНеделя 1: согласовать часы связи. Неделя 2: вести журнал решений. Неделя 3: измерить долю завершённых задач и скорректировать процесс.\n" : ""}`;
      const stored = await storage.put(g.id, content);
      const key = opaqueKey();
      await tx.query(
        `INSERT INTO agent_artifacts(public_key,goal_id,step_id,deal_id,title,storage_ref,checksum,byte_size,revision,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(deal_id,revision) DO NOTHING`,
        [
          key,
          g.id,
          step.id,
          d.id,
          `Обзор удалённой работы · версия ${revision + 1}`,
          stored.reference,
          stored.checksum,
          stored.byteSize,
          revision,
          JSON.stringify({
            revision,
            requiredSections: opportunity.requirements,
          }),
        ],
      );
      await tx.query(
        "UPDATE agent_deals SET status='working',revision=$2 WHERE id=$1",
        [d.id, revision],
      );
      return {
        ...this.observation(
          "verify_artifact",
          key,
          revision
            ? "Документ обновлён по замечанию клиента"
            : "Создан и сохранён документ",
        ),
        revision,
      };
    }
    const artifact = (
      await tx.query<{
        id: string;
        public_key: string;
        storage_ref: string;
        checksum: string;
        verified: boolean;
      }>("SELECT * FROM agent_artifacts WHERE deal_id=$1 AND revision=$2", [
        d.id,
        g.revision,
      ])
    ).rows[0];
    if (tool === "verify_artifact") {
      if (!artifact) throw new Error("Missing artifact");
      const content = await storage.get(artifact.storage_ref);
      if (
        content.length < 300 ||
        content.length > 20000 ||
        !opportunity.requirements.every((section) =>
          content.includes("## " + section),
        ) ||
        (g.revision > 0 && !content.includes("## План внедрения")) ||
        createHash("sha256").update(content).digest("hex") !== artifact.checksum
      )
        throw new Error("Artifact verification failed");
      await tx.query("UPDATE agent_artifacts SET verified=true WHERE id=$1", [
        artifact.id,
      ]);
      return this.observation(
        "deliver",
        artifact.public_key,
        "Проверены все разделы, объём и контрольная сумма документа",
      );
    }
    if (tool === "deliver") {
      if (!artifact?.verified) throw new Error("Unverified artifact");
      await storage.get(artifact.storage_ref);
      await tx.query("UPDATE agent_deals SET status='delivered' WHERE id=$1", [
        d.id,
      ]);
      return {
        ...this.observation(
          "delivery_response",
          await message("delivery", "Проверенный документ передан клиенту"),
          "Проверенный результат передан клиенту",
        ),
        wait: true,
      };
    }
    if (tool === "delivery_response") {
      if (d.status !== "delivered") throw new Error("Delivery missing");
      const review = this.client.reviewDelivery(g.revision),
        revise = !review.accepted;
      await tx.query("UPDATE agent_deals SET status=$2 WHERE id=$1", [
        d.id,
        revise ? "revision_requested" : "delivery_accepted",
      ]);
      return this.observation(
        revise ? "revise_artifact" : "invoice",
        await message(
          revise ? "revision" : "delivery_acceptance",
          review.feedback,
        ),
        revise
          ? "Клиент запросил конкретную правку: план внедрения"
          : "Клиент подтвердил приёмку документа",
      );
    }
    if (tool === "invoice") {
      if (d.status !== "delivery_accepted" || !artifact?.verified)
        throw new Error("Invoice not ready");
      const invoice = d.invoice_key ?? this.payments.createInvoice();
      await tx.query(
        "UPDATE agent_deals SET status='invoiced',invoice_key=$2 WHERE id=$1",
        [d.id, invoice],
      );
      return {
        ...this.observation(
          "payment",
          invoice,
          "Одобренный демонстрационный счёт выставлен клиенту",
        ),
        wait: true,
      };
    }
    if (tool === "payment") {
      if (!d.invoice_key) throw new Error("Missing invoice");
      const evidence = this.payments.getStatus(
        d.invoice_key,
        Number(d.amount_minor),
        d.currency,
      );
      await recordMockPayment(tx, g.id, d.id, evidence);
      return {
        ...this.observation(
          "search",
          evidence.providerEventId,
          "Демонстрационный провайдер подтвердил точную сумму и валюту оплаты",
        ),
        paid: true,
      };
    }
    throw new Error("Unsupported tool");
  }
  private observation(
    next: ToolName,
    reference: string,
    description: string,
  ): MockObservation {
    return { next, ...evidenceSchema.parse({ reference, description }) };
  }
}
/** Server-side only: never exposed to a browser endpoint. The caller owns goal/profile locks. */
export async function recordMockPayment(
  tx: DatabaseExecutor,
  goalId: string,
  dealId: string,
  e: PaymentEvidence,
) {
  const d = (
    await tx.query<Deal>(
      "SELECT * FROM agent_deals WHERE id=$1 AND goal_id=$2 FOR UPDATE",
      [dealId, goalId],
    )
  ).rows[0];
  if (
    !d ||
    !["invoiced", "paid"].includes(d.status) ||
    d.invoice_key !== e.invoiceKey ||
    Number(d.amount_minor) !== e.amountMinor ||
    d.currency !== e.currency ||
    !Number.isSafeInteger(e.amountMinor)
  )
    throw new Error("Payment evidence mismatch");
  await tx.query(
    `INSERT INTO agent_payment_events(provider_event_id,goal_id,deal_id,invoice_key,amount_minor,currency,provider) VALUES($1,$2,$3,$4,$5,$6,'mock') ON CONFLICT(provider_event_id) DO NOTHING`,
    [
      e.providerEventId,
      goalId,
      dealId,
      e.invoiceKey,
      e.amountMinor,
      e.currency,
    ],
  );
  const evidence = (
    await tx.query<{
      deal_id: string;
      invoice_key: string;
      amount_minor: string;
      currency: string;
    }>("SELECT * FROM agent_payment_events WHERE provider_event_id=$1", [
      e.providerEventId,
    ])
  ).rows[0];
  if (
    !evidence ||
    evidence.deal_id !== dealId ||
    evidence.invoice_key !== e.invoiceKey ||
    Number(evidence.amount_minor) !== e.amountMinor ||
    evidence.currency !== e.currency
  )
    throw new Error("Payment event collision");
  await tx.query("UPDATE agent_deals SET status='paid' WHERE id=$1", [dealId]);
}
