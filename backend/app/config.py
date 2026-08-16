import os
from typing import List, Union, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, field_validator, AliasChoices

class Settings(BaseSettings):
    # App Settings
    PROJECT_NAME: str = "Secure IoT Monitoring System"
    API_V1_STR: str = "/api/v1"
    
    # Database Settings
    DATABASE_URL: str = Field(default="sqlite:///./sensor_data.db")
    
    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def convert_postgres_scheme(cls, v: str) -> str:
        if v and v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql://", 1)
        return v
    
    # Security Settings
    API_SECRET: str = Field(default="dev-api-secret-key-super-secure")
    DEVICE_API_KEY: Optional[str] = Field(default=None)
    
    # CORS Origins (JSON list or comma separated)
    CORS_ALLOWED_ORIGINS: Union[List[str], str] = Field(
        default=["*"],
        validation_alias=AliasChoices("CORS_ALLOWED_ORIGINS", "CORS_ORIGINS")
    )
    
    @field_validator("CORS_ALLOWED_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            if v.startswith("[") and v.endswith("]"):
                import json
                return json.loads(v)
            return [i.strip() for i in v.split(",") if i.strip()]
        return v
    
    # Blockchain Settings
    BLOCKCHAIN_RPC_URL: str = Field(default="http://127.0.0.1:8545")
    BLOCKCHAIN_PRIVATE_KEY: str = Field(default="")
    BLOCKCHAIN_CONTRACT_ADDRESS: str = Field(default="")
    BLOCKCHAIN_CHAIN_ID: int = Field(default=1337)
    
    # Device status offline threshold (seconds)
    OFFLINE_THRESHOLD_SECONDS: int = 10
    
    model_config = SettingsConfigDict(
        env_file=[".env", "../.env", "backend/.env"],
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
