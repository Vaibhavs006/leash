ALTER TABLE "purchases" ADD COLUMN "paypal_approve_url" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "simulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "agent_mode" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "catalog_mode" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "wallet_simulated" boolean DEFAULT false NOT NULL;