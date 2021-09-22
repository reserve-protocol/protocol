from brownie import (
    accounts,
    CircuitBreaker,
    CompoundMath,
    ERC20Mock,
    ReserveRightsTokenMock,
    RSR,
)
from common import Address
from interface import AbstractAccount, AbstractContract, AbstractBackend
from typing import Type, Dict, Set
from brownie.convert.datatypes import HexString

# ============ EVM backend implementation ============


class EVMBackend(AbstractBackend):

    ERC20 = ERC20Mock
    PrevRSR = ReserveRightsTokenMock
    RSR = RSR
    CompoundMath = CompoundMath
    CircuitBreaker = CircuitBreaker

    def __init__(self, num_accounts: int):
        self.accounts = accounts[:num_accounts]


# ============ Python backend implementations ============

class PyAccount(AbstractAccount):

    _address: HexString
    _gas_used: int
    _nonce: int

    def __init__(self, address: Address):
        self._address = address
        self._gas_used = 0
        self._nonce = 0

    @property
    def address(self) -> HexString:
        return self._address

    @property
    def gas_used(self) -> int:
        return self._gas_used

    @property
    def nonce(self) -> int:
        return self._nonce

    def deploy(self, Contract: Type["PyContract"], *args, **kwargs):
        return Contract(self, *args, **kwargs)

class PyContract(AbstractContract):
    def _msgSender(self, kwargs) -> PyAccount:
        if kwargs.get("from") is None:
            raise Exception("Missing kwarg 'from'")
        return kwargs["from"]

class PyBackend(AbstractBackend):

    eth_balances: Dict[Address, int]

    def __init__(self, num_accounts: int):
        self.accounts = [PyAccount(accounts[i].address) for i in range(num_accounts)]
        self.eth_balances = {accounts[i].address: 10 ** 36 for i in range(num_accounts)}

    def eth_balance(self, account: PyAccount) -> int:
        return self.eth_balances.get(account.address, 0)




# ============ Python Mixins ============


class OwnableMixin:

    owner: Address

    def __init__(self, owner: Address):
        self.owner = owner


class PausableMixin:

    is_paused: bool

    def __init__(self):
        self.is_paused = False

    def paused(self):
        return self.is_paused

    def _pause(self):
        self.is_paused = True

    def _unpause(self):
        self.is_paused = False


class AccessControlMixin:

    # Role hash -> Set of addresses
    acls: Dict[HexString, Set[Address]]

    def __init__(self):
        self.acls = {}

    def _addRole(self, role: HexString, account: Address):
        if role not in self.acls:
            self.acls[role] = set()
        self.acls[role].add(account)

    def _hasRole(self, role: HexString, account: Address):
        if role not in self.acls:
            return False
        return account in self.acls[role]
