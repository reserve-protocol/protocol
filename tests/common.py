from brownie import web3
from brownie.convert.datatypes import HexString

Address = HexString

PAUSER_ROLE = web3.solidityKeccak(["string"], ["PAUSER_ROLE"])
