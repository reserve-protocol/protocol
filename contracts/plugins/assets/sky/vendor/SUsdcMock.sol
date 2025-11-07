// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

interface VatLike {
    function hope(address) external;

    function suck(
        address,
        address,
        uint256
    ) external;
}

interface UsdsJoinLike {
    function vat() external view returns (address);

    function usds() external view returns (address);

    function exit(address, uint256) external;
}

interface UsdsLike {
    function transfer(address, uint256) external;

    function transferFrom(
        address,
        address,
        uint256
    ) external;
}

contract SUsdsMock {
    // --- Storage Variables ---

    // Admin
    mapping(address => uint256) public wards;
    // ERC20
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;
    // Savings yield
    uint192 public chi; // The Rate Accumulator  [ray]
    uint64 public rho; // Time of last drip     [unix epoch time]
    uint256 public ssr; // The USDS Savings Rate [ray]

    // --- Constants ---

    // ERC20
    string public constant name = "Savings USDS";
    string public constant symbol = "sUSDS";
    string public constant version = "1";
    uint8 public constant decimals = 18;
    // Math
    uint256 private constant RAY = 10**27;

    // --- Immutables ---

    // EIP712
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
    // Savings yield
    UsdsJoinLike public immutable usdsJoin;
    VatLike public immutable vat;
    UsdsLike public immutable usds;
    address public immutable vow;

    constructor(address usdsJoin_, address vow_) {
        usdsJoin = UsdsJoinLike(usdsJoin_);
        vat = VatLike(UsdsJoinLike(usdsJoin_).vat());
        usds = UsdsLike(UsdsJoinLike(usdsJoin_).usds());
        vow = vow_;

        chi = uint192(RAY);
        rho = uint64(block.timestamp);
        ssr = RAY;
        vat.hope(address(usdsJoin));
        wards[msg.sender] = 1;
    }

    // Mock function to be able to override chi in tests
    function setChi(uint192 newValue) external {
        chi = newValue;
    }
}
