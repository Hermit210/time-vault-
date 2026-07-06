use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Owner is still active")]
    StillActive,
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Arithmetic error in timeout calculation")]
    ArithmeticError,
    #[msg("Invalid timeout value")]
    InvalidTimeout,
}

