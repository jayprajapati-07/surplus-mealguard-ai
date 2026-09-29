-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "linkPath" TEXT;

-- CreateTable
CREATE TABLE "RiskThreshold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "medKg" REAL NOT NULL DEFAULT 2,
    "highKg" REAL NOT NULL DEFAULT 5,
    "minSales" INTEGER NOT NULL DEFAULT 2,
    "minSpanMin" INTEGER NOT NULL DEFAULT 30,
    "windowsJson" TEXT,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RiskThreshold_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FoodFlowEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT,
    "foodItemId" TEXT,
    "stage" TEXT NOT NULL,
    "quantityKg" REAL NOT NULL,
    "notes" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mealType" TEXT,
    "entryKind" TEXT NOT NULL DEFAULT 'PRODUCTION',
    "direction" TEXT NOT NULL DEFAULT 'ADD',
    "refKind" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    CONSTRAINT "FoodFlowEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FoodFlowEntry_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FoodFlowEntry_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FoodFlowEntry" ("foodItemId", "id", "kitchenUnitId", "notes", "organizationId", "quantityKg", "recordedAt", "stage") SELECT "foodItemId", "id", "kitchenUnitId", "notes", "organizationId", "quantityKg", "recordedAt", "stage" FROM "FoodFlowEntry";
DROP TABLE "FoodFlowEntry";
ALTER TABLE "new_FoodFlowEntry" RENAME TO "FoodFlowEntry";
CREATE INDEX "FoodFlowEntry_organizationId_stage_idx" ON "FoodFlowEntry"("organizationId", "stage");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "RiskThreshold_organizationId_key" ON "RiskThreshold"("organizationId");
