-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NgoMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentId" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "score" INTEGER NOT NULL DEFAULT 0,
    "reasonsJson" TEXT,
    "deliveryJson" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NgoMatch_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "SurplusEligibilityAssessment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NgoMatch_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NgoOrganization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_NgoMatch" ("assessmentId", "createdAt", "id", "ngoId", "notes", "status") SELECT "assessmentId", "createdAt", "id", "ngoId", "notes", "status" FROM "NgoMatch";
DROP TABLE "NgoMatch";
ALTER TABLE "new_NgoMatch" RENAME TO "NgoMatch";
CREATE INDEX "NgoMatch_assessmentId_idx" ON "NgoMatch"("assessmentId");
CREATE INDEX "NgoMatch_ngoId_idx" ON "NgoMatch"("ngoId");
CREATE UNIQUE INDEX "NgoMatch_assessmentId_ngoId_key" ON "NgoMatch"("assessmentId", "ngoId");
CREATE TABLE "new_NgoOrganization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "acceptedCategories" TEXT,
    "pickupCapable" BOOLEAN NOT NULL DEFAULT true,
    "operatingHours" TEXT,
    "capacityKg" REAL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_NgoOrganization" ("address", "city", "contactEmail", "contactPhone", "createdAt", "id", "name", "updatedAt") SELECT "address", "city", "contactEmail", "contactPhone", "createdAt", "id", "name", "updatedAt" FROM "NgoOrganization";
DROP TABLE "NgoOrganization";
ALTER TABLE "new_NgoOrganization" RENAME TO "NgoOrganization";
CREATE UNIQUE INDEX "NgoOrganization_name_key" ON "NgoOrganization"("name");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "organizationId" TEXT,
    "ngoOrganizationId" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT,
    "resetToken" TEXT,
    "resetExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_ngoOrganizationId_fkey" FOREIGN KEY ("ngoOrganizationId") REFERENCES "NgoOrganization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("createdAt", "email", "emailVerified", "id", "name", "organizationId", "passwordHash", "resetExpiresAt", "resetToken", "role", "updatedAt", "verificationToken") SELECT "createdAt", "email", "emailVerified", "id", "name", "organizationId", "passwordHash", "resetExpiresAt", "resetToken", "role", "updatedAt", "verificationToken" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_verificationToken_key" ON "User"("verificationToken");
CREATE UNIQUE INDEX "User_resetToken_key" ON "User"("resetToken");
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_ngoOrganizationId_idx" ON "User"("ngoOrganizationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
