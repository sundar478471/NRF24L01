import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from typing import Tuple, Optional
from sqlalchemy.orm import Session
from web3 import AsyncWeb3
from web3.providers import AsyncHTTPProvider
from web3.exceptions import Web3Exception

from backend.app.config import settings
from backend.app.database import SessionLocal
from backend.app.models import BlockchainRecord, SensorReading

logger = logging.getLogger("blockchain_worker")
logger.setLevel(logging.INFO)

# Smart Contract ABI
REGISTRY_ABI = [
    {
        "inputs": [
            {"internalType": "string", "name": "deviceId", "type": "string"},
            {"internalType": "uint256", "name": "packetNumber", "type": "uint256"},
            {"internalType": "bytes32", "name": "dataHash", "type": "bytes32"}
        ],
        "name": "recordSensorHash",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "string", "name": "deviceId", "type": "string"},
            {"internalType": "uint256", "name": "packetNumber", "type": "uint256"}
        ],
        "name": "getSensorHash",
        "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "string", "name": "deviceId", "type": "string"}
        ],
        "name": "getDevice",
        "outputs": [
            {"internalType": "address", "name": "authority", "type": "address"},
            {"internalType": "bool", "name": "isRegistered", "type": "bool"}
        ],
        "stateMutability": "view",
        "type": "function"
    }
]

# Queue for async blockchain processing
blockchain_queue = asyncio.Queue()

def compute_sensor_hash(
    device_id: str,
    temperature: float,
    humidity: float,
    motion: bool,
    packet_number: int,
    received_at: datetime
) -> str:
    """
    Generates a deterministic SHA-256 hash for a sensor reading.
    Formatting floats to 1 decimal place prevents float differences across stacks.
    Uses canonical UTC ISO-8601 representation for datetime serialization to ensure determinism.
    """
    if received_at.tzinfo is not None:
        utc_dt = received_at.astimezone(timezone.utc)
    else:
        utc_dt = received_at.replace(tzinfo=timezone.utc)
        
    # Standardize string format by using a naive UTC representation + 'Z' suffix
    naive_utc = utc_dt.replace(tzinfo=None)
    iso_time = naive_utc.isoformat() + "Z"

    # Deterministic payload construction
    payload = f"{device_id}:{temperature:.1f}:{humidity:.1f}:{str(motion).lower()}:{packet_number}:{iso_time}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()

async def enqueue_blockchain_record(record_id: int):
    """Puts a blockchain record ID on the processing queue."""
    await blockchain_queue.put(record_id)
    logger.info(f"Enqueued blockchain record ID: {record_id}")

class BlockchainClient:
    def __init__(self):
        self.is_mock = not (settings.BLOCKCHAIN_PRIVATE_KEY and settings.BLOCKCHAIN_CONTRACT_ADDRESS)
        if self.is_mock:
            logger.info("Blockchain credentials not configured. Running in MOCK Blockchain mode.")
            self.w3 = None
            self.contract = None
        else:
            try:
                logger.info(f"Connecting to RPC: {settings.BLOCKCHAIN_RPC_URL}")
                self.w3 = AsyncWeb3(AsyncHTTPProvider(settings.BLOCKCHAIN_RPC_URL))
                self.contract_address = self.w3.to_checksum_address(settings.BLOCKCHAIN_CONTRACT_ADDRESS)
                self.contract = self.w3.eth.contract(address=self.contract_address, abi=REGISTRY_ABI)
                self.private_key = settings.BLOCKCHAIN_PRIVATE_KEY
                self.account = self.w3.eth.account.from_key(self.private_key)
                logger.info(f"Loaded authority wallet address: {self.account.address}")
            except Exception as e:
                logger.error(f"Error initializing real blockchain provider: {e}. Falling back to MOCK mode.")
                self.is_mock = True
                self.w3 = None
                self.contract = None
                self.private_key = None
                self.account = None

    async def verify_hash_on_chain(self, device_id: str, packet_number: int, computed_hash: str) -> Tuple[str, Optional[str], Optional[int]]:
        """
        Queries the blockchain to verify a hash.
        Returns (verification_status, onchain_hash, block_number).
        """
        if self.is_mock or self.contract is None:
            # Mock verification
            return "VERIFIED", computed_hash, 999999

        try:
            # Query contract
            stored_bytes32 = await self.contract.functions.getSensorHash(
                device_id,
                packet_number
            ).call()
            
            stored_hash = stored_bytes32.hex()
            if not stored_hash.startswith("0x"):
                stored_hash = "0x" + stored_hash
                
            expected_hash = "0x" + computed_hash if not computed_hash.startswith("0x") else computed_hash

            if stored_bytes32 == b'\x00' * 32:
                return "NOT_REGISTERED", None, None
            elif stored_hash.lower() == expected_hash.lower():
                return "VERIFIED", stored_hash, None # block number would require scanning events, return None or query receipt
            else:
                logger.warning(f"Integrity check failed: local {expected_hash} vs chain {stored_hash}")
                return "INTEGRITY_FAILURE", stored_hash, None
        except Exception as e:
            logger.error(f"Error querying blockchain: {e}")
            return "PENDING", None, None

    async def record_hash_on_chain(self, device_id: str, packet_number: int, data_hash_hex: str) -> Tuple[str, int]:
        """
        Submits a sensor data hash to the smart contract.
        Returns (transaction_hash, block_number).
        """
        if self.is_mock or self.w3 is None or self.contract is None or self.account is None or self.private_key is None:
            # Simulate network latency and return mock values
            await asyncio.sleep(1.5)
            mock_tx = f"0xmock{hashlib.sha256(f'{device_id}{packet_number}{data_hash_hex}'.encode()).hexdigest()[:60]}"
            return mock_tx, 123456

        # Convert hex hash to bytes32 bytes
        hash_to_send = data_hash_hex
        if hash_to_send.startswith("0x"):
            hash_to_send = hash_to_send[2:]
        hash_bytes = bytes.fromhex(hash_to_send)

        # Get transaction nonce
        nonce = await self.w3.eth.get_transaction_count(self.account.address)

        # Build transaction
        tx = await self.contract.functions.recordSensorHash(
            device_id,
            packet_number,
            hash_bytes
        ).build_transaction({
            'from': self.account.address,
            'nonce': nonce,
            'chainId': settings.BLOCKCHAIN_CHAIN_ID,
            'gas': 150000, # Static limit or estimateGas
            'gasPrice': await self.w3.eth.gas_price
        })

        # Sign transaction
        signed_tx = self.w3.eth.account.sign_transaction(tx, private_key=self.private_key)

        # Send raw transaction
        tx_hash = await self.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        
        # Wait for receipt
        receipt = await self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        
        if receipt['status'] != 1:
            raise Web3Exception(f"Transaction failed on chain with status: {receipt['status']}")

        return self.w3.to_hex(tx_hash), receipt['blockNumber']

# Instantiate client singleton
blockchain_client = BlockchainClient()

async def process_blockchain_record(record_id: int):
    """Processes a single pending blockchain record by submitting to the EVM network."""
    db: Session = SessionLocal()
    try:
        record = db.query(BlockchainRecord).filter(BlockchainRecord.id == record_id).first()
        if not record:
            logger.error(f"Record with ID {record_id} not found in database.")
            return

        if record.verification_status == "VERIFIED":
            logger.info(f"Record {record_id} already verified on-chain. Skipping.")
            return

        logger.info(f"Submitting record {record_id} for device {record.device_id}, packet {record.sensor_reading.packet_number} to blockchain...")
        
        # Send to chain
        tx_hash, block_num = await blockchain_client.record_hash_on_chain(
            device_id=record.device_id,
            packet_number=record.sensor_reading.packet_number,
            data_hash_hex=record.data_hash
        )

        # Update database status
        record.transaction_hash = tx_hash
        record.block_number = block_num
        record.recorded_at = datetime.now(timezone.utc)
        record.verification_status = "VERIFIED"
        db.commit()

        # Publish a message via a global UI update mechanism (handled in main.py via WebSockets)
        from backend.app.main import manager
        await manager.broadcast({
            "type": "BLOCKCHAIN_RECORD_UPDATED",
            "data": {
                "id": record.id,
                "sensor_record_id": record.sensor_record_id,
                "device_id": record.device_id,
                "packet_number": record.sensor_reading.packet_number,
                "transaction_hash": tx_hash,
                "block_number": block_num,
                "verification_status": "VERIFIED"
            }
        })
        logger.info(f"Successfully recorded hash on-chain for record {record_id}. Tx: {tx_hash}")

    except Exception as e:
        logger.error(f"Error processing blockchain record {record_id}: {e}")
        # Mark as FAILED or retry in a real background worker, we'll leave it pending for retry
        db.rollback()
    finally:
        db.close()

async def blockchain_worker_loop():
    """Infinite loop pulling pending items from the queue and executing them."""
    logger.info("Blockchain background worker started.")
    while True:
        try:
            record_id = await blockchain_queue.get()
            await process_blockchain_record(record_id)
            blockchain_queue.task_done()
        except asyncio.CancelledError:
            logger.info("Blockchain worker loop cancelled.")
            break
        except Exception as e:
            logger.error(f"Unexpected error in worker loop: {e}")
            await asyncio.sleep(2) # Prevent rapid looping on persistent errors
