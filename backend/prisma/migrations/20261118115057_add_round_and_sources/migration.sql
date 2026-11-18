-- CreateTable
CREATE TABLE "Discussion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "expertCount" INTEGER NOT NULL DEFAULT 4,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Round" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "question" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Round_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PanelMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "stance" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PanelMember_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "panelMemberId" TEXT NOT NULL,
    "roundId" TEXT,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'speech',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_panelMemberId_fkey" FOREIGN KEY ("panelMemberId") REFERENCES "PanelMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConsensusItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ConsensusItem_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConsensusItemMessage" (
    "consensusItemId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,

    PRIMARY KEY ("consensusItemId", "messageId"),
    CONSTRAINT "ConsensusItemMessage_consensusItemId_fkey" FOREIGN KEY ("consensusItemId") REFERENCES "ConsensusItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConsensusItemMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Round_discussionId_seq_key" ON "Round"("discussionId", "seq");

-- CreateIndex
CREATE INDEX "PanelMember_discussionId_createdAt_idx" ON "PanelMember"("discussionId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_discussionId_createdAt_idx" ON "Message"("discussionId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsensusItem_discussionId_createdAt_idx" ON "ConsensusItem"("discussionId", "createdAt");
