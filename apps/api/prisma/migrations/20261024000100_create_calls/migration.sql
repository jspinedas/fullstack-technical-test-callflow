CREATE TABLE "calls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "call_id" VARCHAR(100) NOT NULL,
    "phone_number" VARCHAR(30) NOT NULL,
    "agent" VARCHAR(150) NOT NULL,
    "duration" INTEGER NOT NULL,
    "recording_url" TEXT,
    "is_spam" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registration_order" BIGSERIAL NOT NULL,
    CONSTRAINT "calls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "calls_duration_nonnegative" CHECK ("duration" >= 0),
    CONSTRAINT "calls_call_id_nonempty" CHECK (length(btrim("call_id")) > 0),
    CONSTRAINT "calls_agent_nonempty" CHECK (length(btrim("agent")) > 0),
    CONSTRAINT "calls_phone_e164" CHECK ("phone_number" ~ '^\+[1-9][0-9]{1,14}$')
);

CREATE UNIQUE INDEX "calls_call_id_key" ON "calls"("call_id");
CREATE UNIQUE INDEX "calls_registration_order_key" ON "calls"("registration_order");
CREATE INDEX "calls_phone_registration_idx" ON "calls"("phone_number", "registration_order");
