[[ -f "$VES_REAL_ZDOTDIR/.zshrc" ]] && source "$VES_REAL_ZDOTDIR/.zshrc"

autoload -Uz add-zsh-hook
_ves_precmd() {
  local ec=$?
  [[ -n $_ves_on ]] && print -n "\e]133;D;$ec\a"   # close previous command
  print -n "\e]133;A\a"                              # new prompt begins
  _ves_on=1
}
_ves_preexec() { print -n "\e]133;C\a" }             # command output begins
add-zsh-hook precmd _ves_precmd
add-zsh-hook preexec _ves_preexec
PS1="$PS1"$'%{\e]133;B\a%}'                           # mark end of prompt (zero-width)
