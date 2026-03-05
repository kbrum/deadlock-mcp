import axios, { type AxiosError } from "axios";
import {
  AnalyticsApi,
  Configuration as DeadlockApiConfiguration,
  type HeroStats,
  type ItemStats,
  type PlayerMatchHistoryEntry,
  PlayersApi
} from "deadlock_api_client";
import {
  Configuration as DeadlockAssetsConfiguration,
  ItemsApi,
  type ResponseGetItemV2ItemsIdOrClassNameGet,
  type ResponseGetItemsV2ItemsGetInner
} from "assets_deadlock_api_client";

type MatchHistoryOptions = {
  forceRefetch?: boolean;
  onlyStoredHistory?: boolean;
  limit?: number;
};

type HeroStatsOptions = {
  heroIdsCsv?: string;
  limit?: number;
};

type ItemStatsOptions = {
  heroId?: number;
  minMatches?: number;
  limit?: number;
};

type ItemCatalogOptions = {
  language?: string;
  type?: string;
  slotType?: string;
  heroId?: number;
  limit?: number;
  offset?: number;
};

type MatchItemEvent = {
  game_time_s?: number;
  item_id?: number;
  sold_time_s?: number | null;
};

type MatchStatSnapshot = {
  time_stamp_s?: number;
  player_damage?: number;
  player_damage_taken?: number;
  damage_mitigated?: number;
  player_healing?: number;
  self_healing?: number;
  teammate_healing?: number;
  teammate_barriering?: number;
  player_barriering?: number;
  boss_damage?: number;
  neutral_damage?: number;
  creep_damage?: number;
  shots_hit?: number;
  shots_missed?: number;
};

type MatchPlayer = {
  account_id?: number;
  team?: number;
  hero_id?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  net_worth?: number;
  last_hits?: number;
  denies?: number;
  items?: Array<MatchItemEvent>;
  stats?: Array<MatchStatSnapshot>;
};

type MatchInfo = {
  match_id?: number;
  start_time?: number;
  duration_s?: number;
  winning_team?: number;
  players?: Array<MatchPlayer>;
};

type MatchMetadataResponse = {
  match_info?: MatchInfo;
};

const DEADLOCK_API_BASE_URL = "https://api.deadlock-api.com";
const DEADLOCK_ASSETS_BASE_URL = "https://assets.deadlock-api.com";
const USER_AGENT = "deadlock-mcp/0.1.0";

function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) {
    return true;
  }

  return status === 429 || status >= 500;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const payload = error.response?.data;
    const payloadText =
      typeof payload === "string"
        ? payload
        : payload === undefined
          ? ""
          : JSON.stringify(payload);

    return `HTTP ${status ?? "network"}: ${payloadText || error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function extractItemDescription(item: ResponseGetItemsV2ItemsGetInner | ResponseGetItemV2ItemsIdOrClassNameGet): string | null {
  const descriptionValue = (item as { description?: unknown }).description;

  if (typeof descriptionValue === "string") {
    return descriptionValue;
  }

  if (descriptionValue && typeof descriptionValue === "object") {
    const descriptionObject = descriptionValue as {
      desc?: string | null;
      desc2?: string | null;
      active?: string | null;
      passive?: string | null;
    };

    const parts = [descriptionObject.desc, descriptionObject.desc2, descriptionObject.active, descriptionObject.passive]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0);

    return parts.length > 0 ? parts.join(" | ") : null;
  }

  return null;
}

function summarizeItem(item: ResponseGetItemsV2ItemsGetInner): {
  id: number;
  name: string;
  class_name: string;
  type: string;
  slot_type: string | null;
  tier: string | number | null;
  cost: number | null;
  description: string | null;
} {
  return {
    id: item.id,
    name: item.name,
    class_name: item.class_name,
    type: item.type,
    slot_type: "item_slot_type" in item ? item.item_slot_type : null,
    tier: "item_tier" in item ? item.item_tier : null,
    cost: "cost" in item ? item.cost : null,
    description: extractItemDescription(item)
  };
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isKnownAccountId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function summarizeFinalItems(items: Array<MatchItemEvent>): Array<{ item_id: number; count: number; last_bought_at_s: number | null }> {
  const accumulator = new Map<number, { count: number; lastBoughtAt: number | null }>();

  for (const itemEvent of items) {
    const itemId = itemEvent.item_id;
    if (!isKnownAccountId(itemId)) {
      continue;
    }

    const soldTime = itemEvent.sold_time_s;
    if (typeof soldTime === "number" && soldTime > 0) {
      continue;
    }

    const current = accumulator.get(itemId);
    const boughtAt = toNumber(itemEvent.game_time_s);

    if (current) {
      current.count += 1;
      current.lastBoughtAt = Math.max(current.lastBoughtAt ?? -1, boughtAt ?? -1);
      continue;
    }

    accumulator.set(itemId, {
      count: 1,
      lastBoughtAt: boughtAt
    });
  }

  return [...accumulator.entries()]
    .map(([item_id, value]) => ({
      item_id,
      count: value.count,
      last_bought_at_s: value.lastBoughtAt
    }))
    .sort((left, right) => (right.last_bought_at_s ?? -1) - (left.last_bought_at_s ?? -1));
}

function summarizePurchaseTimeline(items: Array<MatchItemEvent>, limit: number): Array<{ item_id: number; game_time_s: number | null; sold_time_s: number | null }> {
  const timeline = items
    .filter((itemEvent) => isKnownAccountId(itemEvent.item_id))
    .map((itemEvent) => ({
      item_id: itemEvent.item_id as number,
      game_time_s: toNumber(itemEvent.game_time_s),
      sold_time_s: toNumber(itemEvent.sold_time_s)
    }))
    .sort((left, right) => (left.game_time_s ?? Number.MAX_SAFE_INTEGER) - (right.game_time_s ?? Number.MAX_SAFE_INTEGER));

  return timeline.slice(0, Math.max(1, Math.min(limit, 50)));
}

function getLastStatSnapshot(player: MatchPlayer): MatchStatSnapshot | null {
  const stats = player.stats;
  if (!Array.isArray(stats) || stats.length === 0) {
    return null;
  }

  const sorted = [...stats].sort(
    (left, right) => (toNumber(left.time_stamp_s) ?? -1) - (toNumber(right.time_stamp_s) ?? -1)
  );

  return sorted[sorted.length - 1] ?? null;
}

export class DeadlockClient {
  private readonly playersApi: PlayersApi;
  private readonly analyticsApi: AnalyticsApi;
  private readonly itemsApi: ItemsApi;
  private readonly itemCache = new Map<number, ReturnType<typeof summarizeItem>>();

  public constructor() {
    const apiKey = globalThis.process?.env?.DEADLOCK_API_KEY;
    const apiConfiguration = new DeadlockApiConfiguration({
      basePath: DEADLOCK_API_BASE_URL,
      ...(apiKey ? { apiKey } : {}),
      baseOptions: {
        timeout: 10_000,
        headers: {
          "User-Agent": USER_AGENT
        }
      }
    });

    const assetsConfiguration = new DeadlockAssetsConfiguration({
      basePath: DEADLOCK_ASSETS_BASE_URL,
      baseOptions: {
        timeout: 10_000,
        headers: {
          "User-Agent": USER_AGENT
        }
      }
    });

    this.playersApi = new PlayersApi(apiConfiguration);
    this.analyticsApi = new AnalyticsApi(apiConfiguration);
    this.itemsApi = new ItemsApi(assetsConfiguration);
  }

  private async executeWithRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const shouldRetry = attempt < maxRetries && isRetryableStatus(status);

        if (!shouldRetry) {
          throw new Error(`${operationName} failed: ${toErrorMessage(error)}`);
        }

        await wait(300 * (attempt + 1));
      }
    }

    throw new Error(`${operationName} failed: exhausted retries`);
  }

  private async getMatchMetadata(matchId: number): Promise<MatchInfo> {
    const response = await this.executeWithRetry(
      () =>
        axios.get<MatchMetadataResponse>(`${DEADLOCK_API_BASE_URL}/v1/matches/${matchId}/metadata`, {
          timeout: 15_000,
          headers: {
            "User-Agent": USER_AGENT
          }
        }),
      "getMatchMetadata"
    );

    const matchInfo = response.data.match_info;
    if (!matchInfo || !Array.isArray(matchInfo.players)) {
      throw new Error(`Metadata not available for match ${matchId}`);
    }

    return matchInfo;
  }

  private async resolveMatchAndPlayer(accountId: number, matchId?: number): Promise<{
    match_id: number;
    match_info: MatchInfo;
    me: MatchPlayer;
    enemies: Array<MatchPlayer>;
  }> {
    let resolvedMatchId = matchId;
    if (!resolvedMatchId) {
      const history = await this.getMatchHistory(accountId, {
        limit: 1,
        forceRefetch: true,
        onlyStoredHistory: false
      });
      resolvedMatchId = history.matches[0]?.match_id;
    }

    if (!resolvedMatchId) {
      throw new Error(`No matches found for account ${accountId}`);
    }

    const matchInfo = await this.getMatchMetadata(resolvedMatchId);
    const players = matchInfo.players ?? [];
    const me = players.find((player) => player.account_id === accountId);
    if (!me) {
      throw new Error(`Account ${accountId} not found in match ${resolvedMatchId}`);
    }

    const myTeam = toNumber(me.team);
    const enemies = players.filter((player) => player.account_id !== accountId && toNumber(player.team) !== myTeam);

    return {
      match_id: resolvedMatchId,
      match_info: matchInfo,
      me,
      enemies
    };
  }

  private async resolveItemReferences(itemIds: Array<number>): Promise<Record<number, ReturnType<typeof summarizeItem>>> {
    const uniqueIds = [...new Set(itemIds)].filter((id) => Number.isInteger(id) && id > 0);
    const missingIds = uniqueIds.filter((id) => !this.itemCache.has(id));

    for (const itemId of missingIds) {
      try {
        const details = await this.getItemDetails(String(itemId));
        this.itemCache.set(itemId, {
          id: details.id,
          name: details.name,
          class_name: details.class_name,
          type: details.type,
          slot_type: details.slot_type,
          tier: details.tier,
          cost: details.cost,
          description: details.description
        });
      } catch {
        this.itemCache.set(itemId, {
          id: itemId,
          name: `item_${itemId}`,
          class_name: `item_${itemId}`,
          type: "unknown",
          slot_type: null,
          tier: null,
          cost: null,
          description: null
        });
      }
    }

    const resolved: Record<number, ReturnType<typeof summarizeItem>> = {};
    for (const itemId of uniqueIds) {
      const item = this.itemCache.get(itemId);
      if (item) {
        resolved[itemId] = item;
      }
    }

    return resolved;
  }

  public async getMatchHistory(accountId: number, options: MatchHistoryOptions = {}): Promise<{
    account_id: number;
    summary: {
      matches: number;
      wins: number;
      losses: number;
      win_rate: number;
      avg_kills: number;
      avg_deaths: number;
      avg_assists: number;
      avg_net_worth: number;
    };
    matches: Array<PlayerMatchHistoryEntry>;
  }> {
    const request: { accountId: number; forceRefetch: boolean; onlyStoredHistory: boolean } = {
      accountId,
      forceRefetch: options.forceRefetch ?? true,
      onlyStoredHistory: options.onlyStoredHistory ?? false
    };

    const response = await this.executeWithRetry(() => this.playersApi.matchHistory(request), "getMatchHistory");

    const limit = options.limit ?? 10;
    const matches = response.data.slice(0, Math.max(1, Math.min(limit, 50)));

    const wins = matches.filter((match) => match.match_result === 1).length;
    const losses = matches.length - wins;
    const totals = matches.reduce(
      (accumulator, match) => {
        accumulator.kills += match.player_kills;
        accumulator.deaths += match.player_deaths;
        accumulator.assists += match.player_assists;
        accumulator.netWorth += match.net_worth;
        return accumulator;
      },
      { kills: 0, deaths: 0, assists: 0, netWorth: 0 }
    );

    const divisor = matches.length || 1;

    return {
      account_id: accountId,
      summary: {
        matches: matches.length,
        wins,
        losses,
        win_rate: Number(((wins / divisor) * 100).toFixed(2)),
        avg_kills: Number((totals.kills / divisor).toFixed(2)),
        avg_deaths: Number((totals.deaths / divisor).toFixed(2)),
        avg_assists: Number((totals.assists / divisor).toFixed(2)),
        avg_net_worth: Number((totals.netWorth / divisor).toFixed(2))
      },
      matches
    };
  }

  public async getPlayerHeroStats(accountId: number, options: HeroStatsOptions = {}): Promise<Array<HeroStats>> {
    const response = await this.executeWithRetry(
      () =>
        this.playersApi.playerHeroStats({
          accountIds: [accountId],
          heroIds: options.heroIdsCsv ?? null
        }),
      "getPlayerHeroStats"
    );

    const sorted = [...response.data].sort((left, right) => right.matches_played - left.matches_played);
    const limit = options.limit ?? 20;
    return sorted.slice(0, Math.max(1, Math.min(limit, 100)));
  }

  public async getItemStatsForAccount(accountId: number, options: ItemStatsOptions = {}): Promise<Array<ItemStats>> {
    const response = await this.executeWithRetry(
      () =>
        this.analyticsApi.itemStats({
          accountId,
          heroId: options.heroId ?? null,
          minMatches: options.minMatches ?? null
        }),
      "getItemStatsForAccount"
    );

    const sorted = [...response.data].sort((left, right) => right.matches - left.matches);
    const limit = options.limit ?? 25;
    return sorted.slice(0, Math.max(1, Math.min(limit, 100)));
  }

  public async getItemsCatalog(options: ItemCatalogOptions = {}): Promise<{
    total: number;
    offset: number;
    limit: number;
    items: Array<ReturnType<typeof summarizeItem>>;
  }> {
    const language = options.language as never | undefined;
    let items: Array<ResponseGetItemsV2ItemsGetInner>;

    if (typeof options.heroId === "number") {
      const heroId = options.heroId;
      const request: { id: number; language?: never } = { id: heroId };
      if (language !== undefined) {
        request.language = language;
      }

      const response = await this.executeWithRetry(
        () => this.itemsApi.getItemsByHeroIdV2ItemsByHeroIdIdGet(request),
        "getItemsCatalogByHero"
      );
      items = response.data;
    } else if (typeof options.type === "string") {
      const request: { type: never; language?: never } = { type: options.type as never };
      if (language !== undefined) {
        request.language = language;
      }

      const response = await this.executeWithRetry(
        () => this.itemsApi.getItemsByTypeV2ItemsByTypeTypeGet(request),
        "getItemsCatalogByType"
      );
      items = response.data;
    } else if (typeof options.slotType === "string") {
      const request: { slotType: never; language?: never } = { slotType: options.slotType as never };
      if (language !== undefined) {
        request.language = language;
      }

      const response = await this.executeWithRetry(
        () => this.itemsApi.getItemsBySlotTypeV2ItemsBySlotTypeSlotTypeGet(request),
        "getItemsCatalogBySlotType"
      );
      items = response.data;
    } else {
      const request: { language?: never } = {};
      if (language !== undefined) {
        request.language = language;
      }

      const response = await this.executeWithRetry(
        () => this.itemsApi.getItemsV2ItemsGet(request),
        "getItemsCatalog"
      );
      items = response.data;
    }

    const normalized = items.map(summarizeItem);
    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.max(1, Math.min(options.limit ?? 25, 100));

    return {
      total: normalized.length,
      offset,
      limit,
      items: normalized.slice(offset, offset + limit)
    };
  }

  public async getItemDetails(idOrClassName: string, language?: string): Promise<{
    id: number;
    name: string;
    class_name: string;
    type: string;
    slot_type: string | null;
    tier: string | number | null;
    cost: number | null;
    description: string | null;
    raw: ResponseGetItemV2ItemsIdOrClassNameGet;
  }> {
    const request: { idOrClassName: string; language?: never } = { idOrClassName };
    if (language !== undefined) {
      request.language = language as never;
    }

    const response = await this.executeWithRetry(() => this.itemsApi.getItemV2ItemsIdOrClassNameGet(request), "getItemDetails");

    const item = response.data;

    return {
      id: item.id,
      name: item.name,
      class_name: item.class_name,
      type: item.type,
      slot_type: "item_slot_type" in item ? item.item_slot_type : null,
      tier: "item_tier" in item ? item.item_tier : null,
      cost: "cost" in item ? item.cost : null,
      description: extractItemDescription(item),
      raw: item
    };
  }

  public async getMatchOverview(accountId: number, matchId?: number): Promise<{
    account_id: number;
    match_id: number;
    start_time: number | null;
    duration_s: number | null;
    winning_team: number | null;
    heroes_by_team: {
      team_0: Array<{ account_id: number; hero_id: number }>;
      team_1: Array<{ account_id: number; hero_id: number }>;
      other: Array<{ account_id: number; hero_id: number; team: number | null }>;
    };
  }> {
    const resolved = await this.resolveMatchAndPlayer(accountId, matchId);
    const team0: Array<{ account_id: number; hero_id: number }> = [];
    const team1: Array<{ account_id: number; hero_id: number }> = [];
    const other: Array<{ account_id: number; hero_id: number; team: number | null }> = [];

    for (const player of resolved.match_info.players ?? []) {
      if (!isKnownAccountId(player.account_id) || !isKnownAccountId(player.hero_id)) {
        continue;
      }

      const team = toNumber(player.team);
      if (team === 0) {
        team0.push({ account_id: player.account_id, hero_id: player.hero_id });
      } else if (team === 1) {
        team1.push({ account_id: player.account_id, hero_id: player.hero_id });
      } else {
        other.push({ account_id: player.account_id, hero_id: player.hero_id, team });
      }
    }

    return {
      account_id: accountId,
      match_id: resolved.match_id,
      start_time: toNumber(resolved.match_info.start_time),
      duration_s: toNumber(resolved.match_info.duration_s),
      winning_team: toNumber(resolved.match_info.winning_team),
      heroes_by_team: {
        team_0: team0,
        team_1: team1,
        other
      }
    };
  }

  public async getPlayerMatchPerformance(accountId: number, matchId?: number): Promise<{
    account_id: number;
    match_id: number;
    hero_id: number | null;
    team: number | null;
    kda: {
      kills: number | null;
      deaths: number | null;
      assists: number | null;
      ratio: number | null;
    };
    economy: {
      net_worth: number | null;
      last_hits: number | null;
      denies: number | null;
    };
    combat: {
      player_damage: number | null;
      player_damage_taken: number | null;
      damage_mitigated: number | null;
      player_healing: number | null;
      self_healing: number | null;
      teammate_healing: number | null;
      player_barriering: number | null;
      teammate_barriering: number | null;
      neutral_damage: number | null;
      boss_damage: number | null;
      creep_damage: number | null;
      shots_hit: number | null;
      shots_missed: number | null;
      accuracy: number | null;
    };
  }> {
    const resolved = await this.resolveMatchAndPlayer(accountId, matchId);
    const me = resolved.me;
    const finalStats = getLastStatSnapshot(me);

    const shotsHit = toNumber(finalStats?.shots_hit);
    const shotsMissed = toNumber(finalStats?.shots_missed);
    const totalShots = (shotsHit ?? 0) + (shotsMissed ?? 0);
    const kills = toNumber(me.kills);
    const deaths = toNumber(me.deaths);
    const assists = toNumber(me.assists);

    return {
      account_id: accountId,
      match_id: resolved.match_id,
      hero_id: toNumber(me.hero_id),
      team: toNumber(me.team),
      kda: {
        kills,
        deaths,
        assists,
        ratio:
          kills === null || deaths === null || assists === null
            ? null
            : Number(((kills + assists) / Math.max(1, deaths)).toFixed(2))
      },
      economy: {
        net_worth: toNumber(me.net_worth),
        last_hits: toNumber(me.last_hits),
        denies: toNumber(me.denies)
      },
      combat: {
        player_damage: toNumber(finalStats?.player_damage),
        player_damage_taken: toNumber(finalStats?.player_damage_taken),
        damage_mitigated: toNumber(finalStats?.damage_mitigated),
        player_healing: toNumber(finalStats?.player_healing),
        self_healing: toNumber(finalStats?.self_healing),
        teammate_healing: toNumber(finalStats?.teammate_healing),
        player_barriering: toNumber(finalStats?.player_barriering),
        teammate_barriering: toNumber(finalStats?.teammate_barriering),
        neutral_damage: toNumber(finalStats?.neutral_damage),
        boss_damage: toNumber(finalStats?.boss_damage),
        creep_damage: toNumber(finalStats?.creep_damage),
        shots_hit: shotsHit,
        shots_missed: shotsMissed,
        accuracy: totalShots > 0 ? Number(((shotsHit ?? 0) / totalShots).toFixed(4)) : null
      }
    };
  }

  public async getPlayerMatchItems(accountId: number, matchId?: number): Promise<{
    account_id: number;
    match_id: number;
    hero_id: number | null;
    final_items: Array<{
      item_id: number;
      name: string;
      class_name: string;
      type: string;
      slot_type: string | null;
      tier: string | number | null;
      cost: number | null;
      count: number;
      last_bought_at_s: number | null;
    }>;
    purchase_timeline: Array<{
      item_id: number;
      name: string;
      game_time_s: number | null;
      sold_time_s: number | null;
    }>;
  }> {
    const resolved = await this.resolveMatchAndPlayer(accountId, matchId);
    const me = resolved.me;
    const events = Array.isArray(me.items) ? me.items : [];

    const finalItems = summarizeFinalItems(events);
    const purchaseTimeline = summarizePurchaseTimeline(events, 20);

    const idsToResolve = [
      ...finalItems.map((item) => item.item_id),
      ...purchaseTimeline.map((item) => item.item_id)
    ];
    const references = await this.resolveItemReferences(idsToResolve);

    return {
      account_id: accountId,
      match_id: resolved.match_id,
      hero_id: toNumber(me.hero_id),
      final_items: finalItems.map((item) => ({
        item_id: item.item_id,
        name: references[item.item_id]?.name ?? `item_${item.item_id}`,
        class_name: references[item.item_id]?.class_name ?? `item_${item.item_id}`,
        type: references[item.item_id]?.type ?? "unknown",
        slot_type: references[item.item_id]?.slot_type ?? null,
        tier: references[item.item_id]?.tier ?? null,
        cost: references[item.item_id]?.cost ?? null,
        count: item.count,
        last_bought_at_s: item.last_bought_at_s
      }))
        .filter((item) => item.type !== "ability"),
      purchase_timeline: purchaseTimeline
        .map((event) => ({
        item_id: event.item_id,
        name: references[event.item_id]?.name ?? `item_${event.item_id}`,
        type: references[event.item_id]?.type ?? "unknown",
        game_time_s: event.game_time_s,
        sold_time_s: event.sold_time_s
      }))
        .filter((event) => event.type !== "ability")
        .map(({ type: _type, ...event }) => event)
    };
  }

  public async getEnemyMatchItems(accountId: number, matchId?: number): Promise<{
    account_id: number;
    match_id: number;
    enemies: Array<{
      account_id: number;
      hero_id: number | null;
      team: number | null;
      kda: {
        kills: number | null;
        deaths: number | null;
        assists: number | null;
      };
      combat: {
        player_damage: number | null;
        player_damage_taken: number | null;
        damage_mitigated: number | null;
        player_healing: number | null;
      };
      final_items: Array<{
        item_id: number;
        name: string;
        class_name: string;
        type: string;
        slot_type: string | null;
        tier: string | number | null;
        cost: number | null;
        count: number;
      }>;
    }>;
  }> {
    const resolved = await this.resolveMatchAndPlayer(accountId, matchId);

    const allEnemyFinalItems = resolved.enemies.flatMap((enemy) => {
      const events = Array.isArray(enemy.items) ? enemy.items : [];
      return summarizeFinalItems(events).map((item) => item.item_id);
    });

    const references = await this.resolveItemReferences(allEnemyFinalItems);

    return {
      account_id: accountId,
      match_id: resolved.match_id,
      enemies: resolved.enemies
        .filter((enemy) => isKnownAccountId(enemy.account_id))
        .map((enemy) => {
          const finalStats = getLastStatSnapshot(enemy);
          const finalItems = summarizeFinalItems(Array.isArray(enemy.items) ? enemy.items : []);

          return {
            account_id: enemy.account_id as number,
            hero_id: toNumber(enemy.hero_id),
            team: toNumber(enemy.team),
            kda: {
              kills: toNumber(enemy.kills),
              deaths: toNumber(enemy.deaths),
              assists: toNumber(enemy.assists)
            },
            combat: {
              player_damage: toNumber(finalStats?.player_damage),
              player_damage_taken: toNumber(finalStats?.player_damage_taken),
              damage_mitigated: toNumber(finalStats?.damage_mitigated),
              player_healing: toNumber(finalStats?.player_healing)
            },
            final_items: finalItems
              .map((item) => ({
              item_id: item.item_id,
              name: references[item.item_id]?.name ?? `item_${item.item_id}`,
              class_name: references[item.item_id]?.class_name ?? `item_${item.item_id}`,
              type: references[item.item_id]?.type ?? "unknown",
              slot_type: references[item.item_id]?.slot_type ?? null,
              tier: references[item.item_id]?.tier ?? null,
              cost: references[item.item_id]?.cost ?? null,
              count: item.count
            }))
              .filter((item) => item.type !== "ability")
          };
        })
    };
  }
}
