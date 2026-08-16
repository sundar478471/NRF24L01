import { expect } from "chai";
import { ethers } from "hardhat";
import { SensorDataRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("SensorDataRegistry", function () {
  let registry: SensorDataRegistry;
  let owner: SignerWithAddress;
  let authority: SignerWithAddress;
  let otherUser: SignerWithAddress;
  const deviceId = "receiver-01";

  beforeEach(async function () {
    [owner, authority, otherUser] = await ethers.getSigners();

    const SensorDataRegistryFactory = await ethers.getContractFactory("SensorDataRegistry");
    registry = await SensorDataRegistryFactory.deploy() as SensorDataRegistry;
    await registry.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });
  });

  describe("Device Registration", function () {
    it("Should allow owner to register a device", async function () {
      await expect(registry.registerDevice(deviceId, authority.address))
        .to.emit(registry, "DeviceRegistered")
        .withArgs(deviceId, authority.address);

      const [auth, isReg] = await registry.getDevice(deviceId);
      expect(isReg).to.be.true;
      expect(auth).to.equal(authority.address);
    });

    it("Should reject registration from non-owner", async function () {
      await expect(
        registry.connect(otherUser).registerDevice(deviceId, authority.address)
      ).to.be.revertedWith("Caller is not the owner");
    });
  });

  describe("Recording Sensor Hashes", function () {
    const packetNumber = 42;
    const mockHash = ethers.keccak256(ethers.toUtf8Bytes("temperature:24.5|humidity:60.0|motion:false"));

    beforeEach(async function () {
      await registry.registerDevice(deviceId, authority.address);
    });

    it("Should allow authorized authority to record hash", async function () {
      await expect(registry.connect(authority).recordSensorHash(deviceId, packetNumber, mockHash))
        .to.emit(registry, "SensorHashRecorded")
        .withArgs(deviceId, packetNumber, mockHash, (anyValue: any) => true); // Timestamp checked via emit structure

      expect(await registry.getSensorHash(deviceId, packetNumber)).to.equal(mockHash);
    });

    it("Should allow contract owner to record hash", async function () {
      await expect(registry.connect(owner).recordSensorHash(deviceId, packetNumber, mockHash))
        .to.emit(registry, "SensorHashRecorded");
      expect(await registry.getSensorHash(deviceId, packetNumber)).to.equal(mockHash);
    });

    it("Should reject recording from unauthorized sender", async function () {
      await expect(
        registry.connect(otherUser).recordSensorHash(deviceId, packetNumber, mockHash)
      ).to.be.revertedWith("Not authorized to record data for this device");
    });

    it("Should reject recording for unregistered device", async function () {
      const unregisteredId = "unregistered-01";
      await expect(
        registry.connect(authority).recordSensorHash(unregisteredId, packetNumber, mockHash)
      ).to.be.revertedWith("Device is not registered");
    });

    it("Should prevent overwriting an existing hash", async function () {
      await registry.connect(authority).recordSensorHash(deviceId, packetNumber, mockHash);

      const anotherHash = ethers.keccak256(ethers.toUtf8Bytes("different-data"));
      await expect(
        registry.connect(authority).recordSensorHash(deviceId, packetNumber, anotherHash)
      ).to.be.revertedWith("Record already exists for this packet");
    });
  });

  describe("Verification", function () {
    const packetNumber = 100;
    const mockHash = ethers.keccak256(ethers.toUtf8Bytes("some-sensor-data"));
    const differentHash = ethers.keccak256(ethers.toUtf8Bytes("different-sensor-data"));

    beforeEach(async function () {
      await registry.registerDevice(deviceId, authority.address);
      await registry.connect(authority).recordSensorHash(deviceId, packetNumber, mockHash);
    });

    it("Should return true for correct matching hash", async function () {
      expect(await registry.verifySensorHash(deviceId, packetNumber, mockHash)).to.be.true;
    });

    it("Should return false for different non-matching hash", async function () {
      expect(await registry.verifySensorHash(deviceId, packetNumber, differentHash)).to.be.false;
    });

    it("Should return false for unrecorded packets", async function () {
      expect(await registry.verifySensorHash(deviceId, 999, mockHash)).to.be.false;
    });
  });
});
