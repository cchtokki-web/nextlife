/* eslint-disable @typescript-eslint/no-require-imports -- Legacy CommonJS maintenance script. */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany();
  console.log(users.map(u => ({ id: u.id, email: u.email, dataLength: u.simulationData ? u.simulationData.length : 0 })));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
