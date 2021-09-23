from abc import ABC
from brownie.convert.datatypes import HexString
from dataclasses import dataclass
from enum import Enum
from typing import List

Address = HexString


class Account(Enum):
    """Account enum to support human-readable testing code."""

    Alice = 1
    Bob = 2
    Charlie = 3
    Dave = 4
    # ...
    InsurancePool = 9
    # ....
    RToken = 18


@dataclass
class Token:
    symbol: str
    quantity: int

    def __hash__(self):
        """Uses the Token symbol as the hash, may need to sophisticate later."""
        return hash(self.symbol)

    def __eq__(self, other):
        return self.symbol == other.symbol


class AbstractERC20:
    """The ERC20 interface that the simulation code tests against."""

    def balanceOf(self, account: Account) -> int:
        raise NotImplementedError

    def mint(self, account: Account, amount: int) -> None:
        raise NotImplementedError

    def burn(self, account: Account, amount: int) -> None:
        raise NotImplementedError

    def transfer(self, sender: Account, recipient: Account, amount: int) -> None:
        raise NotImplementedError


class AbstractProtocol(ABC):
    """The top-level protocol interface that simulation code tests against."""

    @property
    def basket_tokens(self) -> List[AbstractERC20]:
        raise NotImplementedError

    @property
    def rtoken(self) -> AbstractERC20:
        raise NotImplementedError

    def issue(self, msg_sender: Account, amount: int):
        raise NotImplementedError

    def redeem(self, msg_sender: Account, amount: int):
        raise NotImplementedError

    def update_basket(self, tokens: List[Token]):
        raise NotImplementedError
