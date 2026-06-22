CREATE TABLE "polymarket_credentials" (
	"user_id" text PRIMARY KEY NOT NULL,
	"encrypted" text NOT NULL,
	"signer_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
