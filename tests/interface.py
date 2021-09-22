from brownie.convert.datatypes import HexString
from abc import ABC
from typing import List, Type


class AbstractAccount(ABC):
    @property
    def address(self) -> HexString:
        raise NotImplementedError

    @property
    def gas_used(self) -> int:
        raise NotImplementedError

    @property
    def nonce(self) -> int:
        raise NotImplementedError

    def balance(self) -> int:
        raise NotImplementedError

    def deploy(self, Contract: Type["AbstractContract"], *args, **kwargs) -> "AbstractContract":
        raise NotImplementedError

    def estimate_gas(self) -> int:
        raise NotImplementedError

    def get_deployment_address(self) -> HexString:
        raise NotImplementedError

    def transfer(self, to: "AbstractAccount", amount: int):
        raise NotImplementedError


class AbstractContract(ABC):
    def __init__(self, deployer: AbstractAccount, *args, **kwargs):
        raise NotImplementedError


class AbstractBackend(ABC):

    accounts: List[AbstractAccount]

    # Contracts
    ERC20: AbstractContract
    PrevRSR: AbstractContract
    RSR: AbstractContract
    CompoundMath: AbstractContract
    CircuitBreaker: AbstractContract

    def __init__(self, num_accounts: int):
        raise NotImplementedError

    def eth_balance(self, account: AbstractAccount) -> int:
        raise NotImplementedError
