from backends import AccessControlMixin, OwnableMixin, PausableMixin, PyAccount, PyContract, PyBackend
from brownie.convert.datatypes import HexString
from common import Address, PAUSER_ROLE
from typing import Dict


class PyERC20(PyContract, OwnableMixin):
    def __init__(self, deployer: PyAccount, name: str, symbol: str):
        super(OwnableMixin, self).__init__(deployer.address)
        self.name = name
        self.symbol = symbol
        self.balances: Dict[Address, int] = {}
        self.allowances: Dict[Address, Dict[Address, int]] = {}

    def balance(self, account: PyAccount) -> int:
        return self.balances.get(account.address, 0)

    def allowance(self, approver: PyAccount, spender: PyAccount) -> int:
        return self.allowances.get(approver.address, {}).get(spender.address, 0)

    def mint(self, amount: int, **kwargs) -> None:
        sender = self._msgSender(kwargs)
        assert sender.address == self.owner, "only owner can mint"
        self.balances[sender.address] += amount


class PyPrevRSR(PyERC20, PausableMixin):
    def __init__(self, deployer: PyAccount):
        super(PyERC20, self).__init__(deployer, "Reserve Rights Token", "RSR")
        super(PausableMixin, self).__init__()

    def pause(self, **kwargs):
        sender = self._msgSender(kwargs)
        assert sender.address == self.owner, "only owner can pause"
        self._pause()

    def unpause(self, **kwargs):
        sender = self._msgSender(kwargs)
        assert sender.address == self.owner, "only owner can unpause"
        self._unpause()


class PyRSR(PyERC20):

    prevRSR: PyPrevRSR
    slowWallet: Address
    multisigWallet: Address

    def __init__(
        self,
        deployer: PyAccount,
        prev_RSR: PyPrevRSR,
        slow_wallet: Address,
        multisig_wallet: Address,
    ):
        super().__init__(deployer, "Reserve Rights Token", "RSR")
        self.prevRSR = prev_RSR
        self.slowWallet = slow_wallet
        self.multisigWallet = multisig_wallet

    def pause(self, **kwargs):
        return self._pause()

    def unpause(self, **kwargs):
        return self._unpause()


class PyCompoundMath(PyContract):
    pass


class PyCircuitBreaker(PyContract, OwnableMixin, PausableMixin, AccessControlMixin):
    def __init__(self, _: PyAccount, owner: Address):
        OwnableMixin.__init__(self, owner)
        PausableMixin.__init__(self)
        AccessControlMixin.__init__(self)
        self._addRole(PAUSER_ROLE, owner)

    def addRole(self, role: HexString, account: Address, **kwargs):
        sender = self._msgSender(kwargs)
        assert sender.address == self.owner, "only owner can addRole"
        self._addRole(role, account)

    def hasRole(self, role: HexString, account: Address):
        return self._hasRole(role, account)

    def pause(self, **kwargs):
        sender = self._msgSender(kwargs)
        assert sender.address == self.owner, "only owner can pause"
        return self._pause()

    def unpause(self, **kwargs):
        sender = self._msgSender(kwargs)
        assert sender.address == self.owner, "only owner can unpause"
        return self._unpause()


class PyBackend0(PyBackend):

    ERC20 = PyERC20
    PrevRSR = PyPrevRSR
    RSR = PyRSR
    CompoundMath = PyCompoundMath
    CircuitBreaker = PyCircuitBreaker

    def __init__(self, num_accounts: int):
        super().__init__(num_accounts)
