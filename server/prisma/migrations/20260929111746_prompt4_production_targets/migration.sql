-- CreateTable
CREATE TABLE "BufferConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'PERCENT',
    "value" REAL NOT NULL DEFAULT 10,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BufferConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductionTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT NOT NULL,
    "foodItemId" TEXT NOT NULL,
    "mealType" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "predictedKg" REAL NOT NULL,
    "bufferKg" REAL NOT NULL,
    "recommendedKg" REAL NOT NULL,
    "adjustedKg" REAL,
    "adjustReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "memoryVersion" TEXT NOT NULL DEFAULT 'memory-v1',
    "inputsJson" TEXT,
    "feedbackJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductionTarget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductionTarget_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductionTarget_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BufferConfig_organizationId_key" ON "BufferConfig"("organizationId");

-- CreateIndex
CREATE INDEX "ProductionTarget_organizationId_date_idx" ON "ProductionTarget"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionTarget_organizationId_kitchenUnitId_foodItemId_mealType_date_key" ON "ProductionTarget"("organizationId", "kitchenUnitId", "foodItemId", "mealType", "date");
