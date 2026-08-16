import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account: ${deployer.address}`);

  const SensorDataRegistry = await ethers.getContractFactory("SensorDataRegistry");
  const registry = await SensorDataRegistry.deploy();

  await registry.waitForDeployment();
  const address = await registry.getAddress();
  console.log(`SensorDataRegistry deployed to: ${address}`);

  // Register default device for local testing and demo
  const defaultDeviceId = "receiver-01";
  console.log(`Registering default device '${defaultDeviceId}' with authority: ${deployer.address}`);
  const tx = await registry.registerDevice(defaultDeviceId, deployer.address);
  await tx.wait();
  console.log(`Device '${defaultDeviceId}' successfully registered on-chain.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
