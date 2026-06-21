CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"total_volume_micro" bigint,
	"combined_liquidity_micro" bigint,
	"earliest_resolution_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_outcomes" (
	"outcome_id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"platform_market_id" text,
	"external_outcome_id" text,
	"outcome_name" text,
	"is_primary" boolean,
	"outcome_index" integer,
	"midpoint_micro" bigint,
	"spread_micro" bigint,
	"result" text,
	"apy" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_tags" (
	"market_id" text NOT NULL,
	"tag_slug" text NOT NULL,
	CONSTRAINT "market_tags_market_id_tag_slug_pk" PRIMARY KEY("market_id","tag_slug")
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text,
	"question" text,
	"display_name_short" text,
	"event_title" text,
	"description" text,
	"status" text,
	"slug" text,
	"platform" text,
	"icon" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"resolution_date" timestamp with time zone,
	"volume_micro" bigint,
	"liquidity_micro" bigint,
	"total_open_interest_micro" bigint,
	"total_volume_micro" bigint,
	"combined_liquidity_micro" bigint,
	"volume_1h_micro" bigint,
	"volume_24h_micro" bigint,
	"price_change_1h_micro" bigint,
	"price_change_24h_micro" bigint,
	"volume_1h_change_pct" real,
	"volume_24h_change_pct" real,
	"price_change_1h_pct" real,
	"price_change_24h_pct" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_markets" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"external_id" text NOT NULL,
	"platform" text NOT NULL,
	"platform_slug" text,
	"question" text,
	"display_name_short" text,
	"event_title" text,
	"image_url" text,
	"icon" text,
	"end_date" timestamp with time zone,
	"tick_size_micro" bigint,
	"minimum_order_size_micro" bigint,
	"fee_rate_bps" integer,
	"fee_rate" real,
	"neg_risk" boolean,
	"price_change_24h_micro" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"key" text PRIMARY KEY NOT NULL,
	"cursor" text,
	"last_synced_at" timestamp with time zone,
	"last_run_status" text,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"slug" text PRIMARY KEY NOT NULL,
	"label" text,
	"active_market_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_outcomes" ADD CONSTRAINT "market_outcomes_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_outcomes" ADD CONSTRAINT "market_outcomes_platform_market_id_platform_markets_id_fk" FOREIGN KEY ("platform_market_id") REFERENCES "public"."platform_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_tags" ADD CONSTRAINT "market_tags_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_tags" ADD CONSTRAINT "market_tags_tag_slug_tags_slug_fk" FOREIGN KEY ("tag_slug") REFERENCES "public"."tags"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_events" ADD CONSTRAINT "platform_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_markets" ADD CONSTRAINT "platform_markets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_outcomes_market_idx" ON "market_outcomes" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "market_outcomes_platform_market_idx" ON "market_outcomes" USING btree ("platform_market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_outcomes_pm_external_uq" ON "market_outcomes" USING btree ("platform_market_id","external_outcome_id");--> statement-breakpoint
CREATE INDEX "market_tags_tag_idx" ON "market_tags" USING btree ("tag_slug");--> statement-breakpoint
CREATE INDEX "markets_platform_idx" ON "markets" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "markets_status_idx" ON "markets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "markets_event_idx" ON "markets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "markets_end_date_idx" ON "markets" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "markets_volume_idx" ON "markets" USING btree ("volume_micro");--> statement-breakpoint
CREATE INDEX "markets_slug_idx" ON "markets" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_events_platform_external_uq" ON "platform_events" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "platform_events_event_idx" ON "platform_events" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_markets_platform_external_uq" ON "platform_markets" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "platform_markets_market_idx" ON "platform_markets" USING btree ("market_id");