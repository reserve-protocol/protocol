// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

//import "contracts/plugins/euler/MerkleProof.sol";
import "contracts/plugins/euler/IEulerCollateral.sol";
import "./ERC20Mock.sol";

contract EulDistributorMock is IEulDistributor {

    address public eul;
    ERC20Mock public eulToken;

    //mapping (address => uint) public claimables;

    uint claimable;
    bytes32[] proof;

    constructor(address eul_) {
        eulToken = ERC20Mock(eul_);
        eul = eul_;
    }

    function setClaimData(uint _claimable, bytes32[] memory _proof) external {
        claimable = _claimable;
        proof = _proof;
    }

    function getClaimData() external view returns(uint, bytes32[] memory) {
        return (claimable, proof);
    }

    function claim(
        address account, 
        address token, 
        uint claimable, 
        bytes32[] calldata proof, 
        address stake) external 
        {
        eulToken.transfer(account, claimable);
    }

}

/*

https://github.com/euler-xyz/eul-merkle-trees

Tx Sender: 0x87f1d596ebcf28f69ded62ae4060d87b7781a9db
Eul Distributor: 0xd524E29E3BAF5BB085403Ca5665301E94387A7e2
EUL Distributor Owner: 0x8E3204ae99605e6fFD2bC72D765F480bF0c05b5d

Roots:
July27: 0x28d13b94a8c2f3fb318f4587170e6f6107a63ce36a11346360aa21ce60c1a43f
tx: https://etherscan.io/tx/0xa978468c2668804f3399a5ce0f9acfd84337e583659878dd8c4397cf98ccb441

July29: 0x934764e99482c3249efc5d837731f0e6e738908602afcc28e53f1570c9677665 
tx: https://etherscan.io/tx/0xd856710b732e8be880eae45dca65b631929eb21d5c2c3377e56cacb4a452a339

August13: 0xad42fea400fa066bd96130e978a8224f0bae396a31eb34556a9aa7aa7da05e5e
tx: https://etherscan.io/tx/0xf06c2dd402a3fb14806f77d2bec8668c86a7e9ae3212fc2dc4441d52b4da521b

*/