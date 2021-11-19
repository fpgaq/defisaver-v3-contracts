// SPDX-License-Identifier: MIT

pragma solidity =0.7.6;
pragma experimental ABIEncoderV2;

import "./../ActionBase.sol";
import "../../utils/TokenUtils.sol";
import "../../DS/DSMath.sol";
import "./helpers/McdHelper.sol";
import "../../interfaces/mcd/IGUniLev.sol";

/// @title Fully leverage a GUNI DAI/USDC vault
contract McdWindGUni is ActionBase, DSMath,  McdHelper{
    using TokenUtils for address;

    /// @param daiAmount amount of dai to pull to dsproxy
    /// @param from address from which to pull dai
    /// @param principal principal for sending to GUniLev contract for leveraging
    /// @param minWalletDai minimum amount of usdc+dai to be sent back after leveraging
    /// @param vaultId vaultId (0 if one doesnt exist, to open new one)
    /// @param mcdManager mcdManager address
    /// @param joinAddr Join addr
    /// @param gUniLevAddr GUniLev contract address
    struct Params {
        uint256 daiAmount;
        address from;
        uint256 principal;
        uint256 minWalletDai;
        uint256 vaultId;
        address mcdManager;
        address joinAddr;
        address gUniLevAddr;
    }

    /// @inheritdoc ActionBase
    function executeAction(
        bytes[] memory _callData,
        bytes[] memory _subData,
        uint8[] memory _paramMapping,
        bytes32[] memory _returnValues
    ) public payable virtual override returns (bytes32) {
        Params memory inputData = parseInputs(_callData);

        uint256 vaultId = openLeveragedPosition(inputData);

        return bytes32(vaultId);
    }

    /// @inheritdoc ActionBase
    function executeActionDirect(bytes[] memory _callData) public payable override {
        Params memory inputData = parseInputs(_callData);

        openLeveragedPosition(inputData);
    }

    /// @inheritdoc ActionBase
    function actionType() public pure virtual override returns (uint8) {
        return uint8(ActionType.STANDARD_ACTION);
    }

    //////////////////////////// ACTION LOGIC ////////////////////////////

    function openLeveragedPosition(Params memory _inputData) internal returns (uint256) {
        _inputData.daiAmount = DAI_ADDR.pullTokensIfNeeded(_inputData.from, _inputData.daiAmount);
        DAI_ADDR.approveToken(_inputData.gUniLevAddr, _inputData.daiAmount);

        vat.hope(_inputData.gUniLevAddr);
        IGUniLev(_inputData.gUniLevAddr).wind(_inputData.principal, _inputData.minWalletDai);
        vat.nope(_inputData.gUniLevAddr);

        IJoin join = IJoin(_inputData.joinAddr);
        bytes32 ilk = join.ilk();
        
        if (_inputData.vaultId == 0){
        _inputData.vaultId = IManager(_inputData.mcdManager).open(ilk, address(this));
        }

        vat.hope(_inputData.mcdManager);
        IManager(_inputData.mcdManager).enter(address(this), _inputData.vaultId);
        vat.nope(_inputData.mcdManager);

        USDC_ADDR.withdrawTokens(_inputData.from , USDC_ADDR.getBalance(address(this)));
        DAI_ADDR.withdrawTokens(_inputData.from, DAI_ADDR.getBalance(address(this)));

        return _inputData.vaultId;
    }

    function parseInputs(bytes[] memory _callData) internal pure returns (Params memory inputData) {
        inputData = abi.decode(_callData[0], (Params));
    }
}