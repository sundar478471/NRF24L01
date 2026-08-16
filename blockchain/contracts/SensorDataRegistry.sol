// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SensorDataRegistry
 * @dev Registry contract for secure sensor metadata integrity validation.
 * Stores device registration and records cryptographic hashes of sensor readings.
 */
contract SensorDataRegistry {
    address public owner;

    struct Device {
        address authority;
        bool isRegistered;
        uint256 registeredAt;
    }

    struct SensorRecord {
        bytes32 dataHash;
        uint256 timestamp;
        address recorder;
    }

    // Mapping: deviceId => Device details
    mapping(string => Device) private devices;

    // Mapping: deviceId => packetNumber => SensorRecord
    mapping(string => mapping(uint256 => SensorRecord)) private sensorRecords;

    // Events
    event DeviceRegistered(string indexed deviceId, address indexed authority);
    event SensorHashRecorded(string indexed deviceId, uint256 indexed packetNumber, bytes32 dataHash, uint256 timestamp);

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Caller is not the owner");
        _;
    }

    modifier onlyAuthorized(string memory deviceId) {
        require(devices[deviceId].isRegistered, "Device is not registered");
        require(
            devices[deviceId].authority == msg.sender || msg.sender == owner,
            "Not authorized to record data for this device"
        );
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @dev Registers a new device with its authorized signing key/address.
     * Only the contract owner can register new devices.
     */
    function registerDevice(string memory deviceId, address authority) external onlyOwner {
        require(bytes(deviceId).length > 0, "Device ID cannot be empty");
        require(authority != address(0), "Invalid authority address");

        devices[deviceId] = Device({
            authority: authority,
            isRegistered: true,
            registeredAt: block.timestamp
        });

        emit DeviceRegistered(deviceId, authority);
    }

    /**
     * @dev Stores the deterministic cryptographic hash of a sensor reading packet.
     * Can only be called by the device's authorized authority or the contract owner.
     */
    function recordSensorHash(
        string memory deviceId,
        uint256 packetNumber,
        bytes32 dataHash
    ) external onlyAuthorized(deviceId) {
        require(dataHash != bytes32(0), "Hash cannot be zero");
        require(sensorRecords[deviceId][packetNumber].dataHash == bytes32(0), "Record already exists for this packet");

        sensorRecords[deviceId][packetNumber] = SensorRecord({
            dataHash: dataHash,
            timestamp: block.timestamp,
            recorder: msg.sender
        });

        emit SensorHashRecorded(deviceId, packetNumber, dataHash, block.timestamp);
    }

    /**
     * @dev Public view function to verify if a given hash matches the registered hash for a packet.
     */
    function verifySensorHash(
        string memory deviceId,
        uint256 packetNumber,
        bytes32 dataHash
    ) external view returns (bool) {
        return sensorRecords[deviceId][packetNumber].dataHash == dataHash;
    }

    /**
     * @dev Public view function to retrieve the registered hash for a device and packet number.
     */
    function getSensorHash(
        string memory deviceId,
        uint256 packetNumber
    ) external view returns (bytes32) {
        return sensorRecords[deviceId][packetNumber].dataHash;
    }

    /**
     * @dev Public view function to check device authority and registration status.
     */
    function getDevice(
        string memory deviceId
    ) external view returns (address authority, bool isRegistered) {
        Device memory d = devices[deviceId];
        return (d.authority, d.isRegistered);
    }
}
