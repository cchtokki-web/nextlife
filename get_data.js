const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany();
  users.forEach(u => console.log(u.email, u.simulationData));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
