-- CreateTable
CREATE TABLE "InventoryThreshold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "lowStockKg" REAL NOT NULL DEFAULT 5,
    "nearExpiryDays" INTEGER NOT NULL DEFAULT 3,
    "excessKg" REAL NOT NULL DEFAULT 100,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryThreshold_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EligibilityConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "minQuantityKg" REAL NOT NULL DEFAULT 10,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EligibilityConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EndOfDayReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT,
    "date" DATETIME NOT NULL,
    "totalPreparedKg" REAL NOT NULL,
    "totalServedKg" REAL NOT NULL,
    "totalWasteKg" REAL NOT NULL,
    "totalSurplusKg" REAL NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'FINAL',
    "accuracyJson" TEXT,
    "qualityNotes" TEXT,
    "reopenedAt" DATETIME,
    "reopenReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EndOfDayReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EndOfDayReport_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_EndOfDayReport" ("createdAt", "date", "id", "kitchenUnitId", "notes", "organizationId", "totalPreparedKg", "totalServedKg", "totalSurplusKg", "totalWasteKg") SELECT "createdAt", "date", "id", "kitchenUnitId", "notes", "organizationId", "totalPreparedKg", "totalServedKg", "totalSurplusKg", "totalWasteKg" FROM "EndOfDayReport";
DROP TABLE "EndOfDayReport";
ALTER TABLE "new_EndOfDayReport" RENAME TO "EndOfDayReport";
CREATE INDEX "EndOfDayReport_organizationId_date_idx" ON "EndOfDayReport"("organizationId", "date");
CREATE TABLE "new_InventoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT,
    "foodItemId" TEXT,
    "batchCode" TEXT,
    "quantityKg" REAL NOT NULL,
    "expiryDate" DATETIME,
    "storageArea" TEXT,
    "supplier" TEXT,
    "purchaseDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryItem_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InventoryItem_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_InventoryItem" ("batchCode", "createdAt", "expiryDate", "foodItemId", "id", "kitchenUnitId", "organizationId", "quantityKg", "storageArea", "updatedAt") SELECT "batchCode", "createdAt", "expiryDate", "foodItemId", "id", "kitchenUnitId", "organizationId", "quantityKg", "storageArea", "updatedAt" FROM "InventoryItem";
DROP TABLE "InventoryItem";
ALTER TABLE "new_InventoryItem" RENAME TO "InventoryItem";
CREATE INDEX "InventoryItem_organizationId_idx" ON "InventoryItem"("organizationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "InventoryThreshold_organizationId_key" ON "InventoryThreshold"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EligibilityConfig_organizationId_key" ON "EligibilityConfig"("organizationId");
