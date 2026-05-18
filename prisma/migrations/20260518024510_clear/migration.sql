-- CreateTable
CREATE TABLE "SimulationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "processType" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "completedPhase" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "loadsCompleted" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "SimulationRun_processType_completedAt_idx" ON "SimulationRun"("processType", "completedAt");

-- CreateIndex
CREATE INDEX "SimulationRun_completedAt_idx" ON "SimulationRun"("completedAt");
