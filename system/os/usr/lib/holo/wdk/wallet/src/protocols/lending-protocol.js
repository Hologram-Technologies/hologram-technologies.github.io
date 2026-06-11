// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
'use strict'

import { NotImplementedError } from '../errors.js'

/** @typedef {import('../wallet-account-read-only.js').IWalletAccountReadOnly} IWalletAccountReadOnly */

/** @typedef {import('../wallet-account.js').IWalletAccount} IWalletAccount */

/**
 * @typedef {Object} SupplyOptions
 * @property {string} token - The address of the token to supply.
 * @property {number | bigint} amount - The amount of tokens to supply (in base unit).
 * @property {string} [onBehalfOf] - The address on behalf of which the supply operation should be performed. If not set, the supply operation will be performed on behalf of the account itself.
 */

/**
 * @typedef {Object} SupplyResult
 * @property {string} hash - The hash of the supply operation.
 * @property {bigint} fee - The gas cost.
 */

/**
 * @typedef {Object} WithdrawOptions
 * @property {string} token - The address of the token to withdraw.
 * @property {number | bigint} amount - The amount of tokens to withdraw (in base unit).
 * @property {string} [to] - The address that should receive the tokens. If not set, the account itself will receive the funds.
 */

/**
 * @typedef {Object} WithdrawResult
 * @property {string} hash - The hash of the withdraw operation.
 * @property {bigint} fee - The gas cost.
 */

/**
 * @typedef {Object} BorrowOptions
 * @property {string} token - The address of the token to borrow.
 * @property {number | bigint} amount - The amount of tokens to borrow (in base unit).
 * @property {string} [onBehalfOf] - The address on behalf of which the borrow operation should be performed. If not set, the borrow operation will be performed on behalf of the account itself.
 */

/**
 * @typedef {Object} BorrowResult
 * @property {string} hash - The hash of the borrow operation.
 * @property {bigint} fee - The gas cost.
 */

/**
 * @typedef {Object} RepayOptions
 * @property {string} token - The address of the token to repay.
 * @property {number | bigint} amount - The amount of tokens to repay (in base unit).
 * @property {string} [onBehalfOf] - The address on behalf of which the repay operation should be performed. If not set, the repay operation will be performed on behalf of the account itself.
 */

/**
 * @typedef {Object} RepayResult
 * @property {string} hash - The hash of the repay operation.
 * @property {bigint} fee - The gas cost.
 */

/** @interface */
export class ILendingProtocol {
  /**
   * Supplies a specific token amount to the lending pool.
   *
   * @param {SupplyOptions} options - The supply's options.
   * @returns {Promise<SupplyResult>} The supply's result.
   */
  async supply (options) {
    throw new NotImplementedError('supply(options)')
  }

  /**
   * Quotes the costs of a supply operation.
   *
   * @param {SupplyOptions} options - The supply's options.
   * @returns {Promise<Omit<SupplyResult, 'hash'>>} The supply's costs.
   */
  async quoteSupply (options) {
    throw new NotImplementedError('quoteSupply(options)')
  }

  /**
   * Withdraws a specific token amount from the pool.
   *
   * @param {WithdrawOptions} options - The withdraw's options.
   * @returns {Promise<WithdrawResult>} The withdraw's result.
   */
  async withdraw (options) {
    throw new NotImplementedError('withdraw(options)')
  }

  /**
   * Quotes the costs of a withdraw operation.
   *
   * @param {WithdrawOptions} options - The withdraw's options.
   * @returns {Promise<Omit<WithdrawResult, 'hash'>>} The withdraw's costs.
   */
  async quoteWithdraw (options) {
    throw new NotImplementedError('quoteWithdraw(options)')
  }

  /**
   * Borrows a specific token amount.
   *
   * @param {BorrowOptions} options - The borrow's options.
   * @returns {Promise<BorrowResult>} The borrow's result.
   */
  async borrow (options) {
    throw new NotImplementedError('borrow(options)')
  }

  /**
   * Quotes the costs of a borrow operation.
   *
   * @param {BorrowOptions} options - The borrow's options.
   * @returns {Promise<Omit<BorrowResult, 'hash'>>} The borrow's costs.
   */
  async quoteBorrow (options) {
    throw new NotImplementedError('quoteBorrow(options)')
  }

  /**
   * Repays a specific token amount.
   *
   * @param {RepayOptions} options - The borrow's options.
   * @returns {Promise<RepayResult>} The repay's result.
   */
  async repay (options) {
    throw new NotImplementedError('repay(options)')
  }

  /**
   * Quotes the costs of a repay operation.
   *
   * @param {RepayOptions} options - The repay's options.
   * @returns {Promise<Omit<RepayResult, 'hash'>>} The repay's costs.
   */
  async quoteRepay (options) {
    throw new NotImplementedError('quoteRepay(options)')
  }
}

/**
 * @abstract
 * @implements {ILendingProtocol}
 */
export default class LendingProtocol {
  /**
   * Creates a new read-only lending protocol.
   *
   * @overload
   * @param {IWalletAccountReadOnly} account - The wallet account to use to interact with the protocol.
   */

  /**
   * Creates a new lending protocol.
   *
   * @overload
   * @param {IWalletAccount} account - The wallet account to use to interact with the protocol.
   */
  constructor (account) {
    /**
     * The wallet account to use to interact with the protocol.
     *
     * @protected
     * @type {IWalletAccountReadOnly | IWalletAccount}
     */
    this._account = account
  }

  /**
   * Supplies a specific token amount to the lending pool.
   *
   * @abstract
   * @param {SupplyOptions} options - The supply's options.
   * @returns {Promise<SupplyResult>} The supply's result.
   */
  async supply (options) {
    throw new NotImplementedError('supply(options)')
  }

  /**
   * Quotes the costs of a supply operation.
   *
   * @abstract
   * @param {SupplyOptions} options - The supply's options.
   * @returns {Promise<Omit<SupplyResult, 'hash'>>} The supply's costs.
   */
  async quoteSupply (options) {
    throw new NotImplementedError('quoteSupply(options)')
  }

  /**
   * Withdraws a specific token amount from the pool.
   *
   * @abstract
   * @param {WithdrawOptions} options - The withdraw's options.
   * @returns {Promise<WithdrawResult>} The withdraw's result.
   */
  async withdraw (options) {
    throw new NotImplementedError('withdraw(options)')
  }

  /**
   * Quotes the costs of a withdraw operation.
   *
   * @abstract
   * @param {WithdrawOptions} options - The withdraw's options.
   * @returns {Promise<Omit<WithdrawResult, 'hash'>>} The withdraw's costs.
   */
  async quoteWithdraw (options) {
    throw new NotImplementedError('quoteWithdraw(options)')
  }

  /**
   * Borrows a specific token amount.
   *
   * @abstract
   * @param {BorrowOptions} options - The borrow's options.
   * @returns {Promise<BorrowResult>} The borrow's result.
   */
  async borrow (options) {
    throw new NotImplementedError('borrow(options)')
  }

  /**
   * Quotes the costs of a borrow operation.
   *
   * @abstract
   * @param {BorrowOptions} options - The borrow's options.
   * @returns {Promise<Omit<BorrowResult, 'hash'>>} The borrow's costs.
   */
  async quoteBorrow (options) {
    throw new NotImplementedError('quoteBorrow(options)')
  }

  /**
   * Repays a specific token amount.
   *
   * @abstract
   * @param {RepayOptions} options - The borrow's options.
   * @returns {Promise<RepayResult>} The repay's result.
   */
  async repay (options) {
    throw new NotImplementedError('repay(options)')
  }

  /**
   * Quotes the costs of a repay operation.
   *
   * @abstract
   * @param {RepayOptions} options - The repay's options.
   * @returns {Promise<Omit<RepayResult, 'hash'>>} The repay's costs.
   */
  async quoteRepay (options) {
    throw new NotImplementedError('quoteRepay(options)')
  }
}
