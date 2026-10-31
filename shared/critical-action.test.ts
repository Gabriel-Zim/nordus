import { describe, expect, it } from "vitest";

import { criticalAction, criticalCommand } from "./critical-action.ts";

describe("criticalAction", () => {
  it("lets ordinary work through", () => {
    for (const tool of ["Read", "Write", "Edit", "WebSearch", "mcp__notion__notion-search", "mcp__zorg__gerar_imagem", "mcp__agents__post_to_room", "mcp__trello__list_cards", "mcp__metricool__get_posts"]) {
      expect(criticalAction(tool), tool).toBeNull();
    }
    for (const command of ["ls -la ~", "npm test", "git status", "curl -s https://api.example.com/x", "rm notes.txt", "ffmpeg -i a.mp4 b.mp4"]) {
      expect(criticalCommand(command), command).toBeNull();
    }
  });

  it("stops spending, settings, permanent deletion, sending and deploys", () => {
    expect(criticalAction("mcp__stripe__create_payment")).toBe("spend");
    expect(criticalAction("mcp__zorg__gerar_video")).toBe("spend");
    expect(criticalAction("mcp__zorg__zorg_mirage")).toBe("spend");
    expect(criticalAction("mcp__cloudflare__update_dns_record")).toBe("config");
    expect(criticalAction("mcp__github__add_repository_secret")).toBe("config");
    expect(criticalAction("mcp__notion__delete_page")).toBe("delete");
    expect(criticalAction("GMAIL_SEND_EMAIL")).toBe("send");
    expect(criticalAction("mcp__linkedin__publish_post")).toBe("send");
    expect(criticalAction("mcp__vercel__deploy_project")).toBe("deploy");
  });

  it("reads the shell command line for a shell tool", () => {
    expect(criticalAction("Bash", "rm -rf ~/projetos")).toBe("delete");
    expect(criticalAction("Bash", "git push origin main")).toBe("deploy");
    expect(criticalAction("Bash", "git push --force origin main")).toBe("delete");
    expect(criticalAction("Bash", "npx wrangler deploy")).toBe("deploy");
    expect(criticalAction("Bash", "sudo systemctl restart nginx")).toBe("config");
    expect(criticalAction("Bash", "curl -X PUT https://api.cloudflare.com/client/v4/zones/z/dns_records/r")).toBe("config");
    expect(criticalAction("Bash", "curl -X PUT \"https://api.cloudflare.com/client/v4/zones/z/dns_records/r\"")).toBe("config");
    expect(criticalAction("Bash", "git commit -m 'never run rm -rf /'")).toBeNull();
    expect(criticalAction("Bash", 'echo "sudo is not run here"')).toBeNull();
    expect(criticalAction("Bash", "ls")).toBeNull();
    expect(criticalAction("Bash")).toBeNull();
  });

  it("stops each real use of a system, account, delete or mail program", () => {
    const config = [
      "sudo -n bash /home/nordus/zorg/bots/programador/release-sudo/aplicar.sh",
      "sudo systemctl restart nginx",
      "echo x | sudo tee /etc/hosts",
      "ssh prod sudo reboot",
      "xargs sudo rm",
      "bash <<EOF\nsudo apt install x\nEOF",
      "$(sudo cat /etc/shadow)",
      "`sudo id`",
      "/usr/bin/sudo cp a /etc/b",
      "env FOO=1 sudo reboot",
      "FOO=1 sudo reboot",
      "time sudo reboot",
      "sudo -u nordus reboot",
      "sudo -unordus reboot",
      "sudo -s",
      "sudo -i",
      "sudo -e /etc/hosts",
      "sudo -l -s",
      "sudo -l reboot",
      "sudo -k reboot",
      "sudo -n true reboot",
      "sudo -E true",
      "sudo -- true",
      "sudo -u true reboot",
      "sudo ./true",
      "sudo /tmp/x/true",
      "sudo",
      "sudo -v; sudo reboot",
      "sudo -n true && sudo reboot",
      "if sudo reboot; then echo ok; fi",
      "sudo -E \\\n  ./install.sh",
      "sudo -n \\\n  bash /home/nordus/aplicar.sh",
      "sudo `which node` app.js",
      "sudo 2>&1 reboot",
      "sudo -k 2>&1 reboot",
      "sudo &>/dev/null reboot",
      "sudo >&2 reboot",
      "sudo${IFS}bash x.sh",
      "eval sudo reboot",
      "pkexec ufw disable",
      "echo sudo reboot | bash",
      "visudo",
      "visudo -f /etc/sudoers.d/x",
      "visudo -f x; visudo -c",
      "visudo -cf x && visudo",
      "/usr/sbin/visudo",
      "useradd bob",
      "adduser nordus sudo",
      "addgroup nordus sudo",
      "gpasswd -a nordus sudo",
      "groupmems -g sudo -a nordus",
      "chpasswd < users.txt",
      "passwd nordus",
      "/usr/bin/passwd nordus",
      "ufw disable",
      "ufw>/dev/null disable",
      "iptables -F",
      "ssh prod ufw allow 22",
      "cat > run.sh <<EOF\nsudo ls\nEOF\nbash run.sh",
      "cat <<EOF >/tmp/a.sh\nsudo ls\nEOF\n. /tmp/a.sh",
      "cat > run.sh <<EOF && bash run.sh\nsudo ls\nEOF",
      'cat > "$f" <<EOF\nsudo ls\nEOF',
      "cat <<EOF | bash\nsudo ls\nEOF",
      "bash $(cat <<EOF\nsudo ls\nEOF\n)",
      "cat > a.txt <<EOF\nhello\nEOF\nsudo reboot",
      "cat > a.txt <<EOF\nhello\nEOF\nsudo reboot\nEOF",
      "cat > a.txt <<E\\OF\nhello\nEOF\nsudo reboot",
      "cat > a.txt <<EOF.\nhello\nEOF.\nsudo reboot",
      "cat > a.sh <<EOF\n$(sudo reboot)\nEOF",
      "cat > a.sh <<EOF\n`sudo reboot`\nEOF",
      "cat > ../a.sh <<'EOF'\nsudo reboot\nEOF",
      "cat > /tmp/a.sh <<'EOF'\nsudo reboot\nEOF",
      "tee -a ~/.profile <<EOF\nsudo ufw disable\nEOF",
      "cat >> ~/.bashrc <<'EOF'\nsudo ufw disable\nEOF",
      "{ cat <<EOF\nsudo reboot\nEOF\n} | bash",
      "(\ncat <<EOF\nsudo reboot\nEOF\n) | bash",
      "if true; then\ncat <<EOF\nsudo reboot\nEOF\nfi | sh",
      "cat <<EOF |\nbash\nsudo reboot\nEOF",
      "cat > run.sh <<'EOF'\nsudo reboot\nEOF\nbash \"run.sh\"",
      "cat > run.sh <<'EOF'\nsudo reboot\nEOF\nfor f in *.sh; do bash $f; done",
      "cat <<'EOF' | sudo tee /etc/sudoers.d/x\nnordus ALL=(ALL) NOPASSWD: ALL\nEOF",
      "grep -r x . | xargs sudo rm",
      "grep x f; sudo reboot",
      "getent group sudo; sudo reboot",
      "grep x $(sudo cat /etc/shadow)",
    ];
    for (const command of config) expect(criticalCommand(command), command).toBe("config");
    expect(criticalCommand("find / -exec shred {} \\;")).toBe("delete");
    expect(criticalCommand("mkfs.ext4 /dev/sdb1")).toBe("delete");
    expect(criticalCommand("wipefs -a /dev/sdb")).toBe("delete");
    expect(criticalCommand("rm -rf /etc/x")).toBe("delete");
    expect(criticalCommand("cat > x.sh <<EOF\nrm -rf /\nEOF\nbash x.sh")).toBe("delete");
    expect(criticalCommand("echo hi | mutt -s oi a@b.c")).toBe("send");
    expect(criticalCommand("git push origin main; shred x")).toBe("delete");
    expect(criticalCommand("sudo ls && sendmail a@b.c")).toBe("send");
  });

  it("ASSISTENTEFINANCEIRO's own e-mail sender sends outside; drafting, reading the state or building an invoice does not", () => {
    for (const command of [
      "enviar-email enviar r20261019-d4ef35",
      "enviar-email enviar r20261019-d4ef35 --para cliente@lumon.com",
      "/home/nordus/.local/bin/enviar-email enviar r20261019-d4ef35",
      "cd /tmp && enviar-email enviar-aprovados",
      'bash -c "enviar-email enviar r20261019-d4ef35"',
      '"/private/tmp/bancada/assistentefinanceiro/bin/enviar-email" enviar r20261019-283ebd --para marco@lumon.test',
      "'/home/nordus/.local/bin/enviar-email' enviar-aprovados",
      "python3 /home/nordus/.local/bin/enviar-email enviar r20261019-d4ef35",
      "enviar-email 'enviar' r20261019-d4ef35",
      "ENVIAR_EMAIL_CONFIG=/x/config.json enviar-email enviar r20261019-d4ef35",
    ]) expect(criticalCommand(command), command).toBe("send");
    for (const command of [
      "enviar-email rascunho --para admin@example.com --assunto teste --html corpo.html",
      "enviar-email estado r20261019-d4ef35",
      "enviar-email estado",
      "montar-invoice --cliente lumon",
      "grep enviar-email ~/.bash_history",
    ]) expect(criticalCommand(command), command).toBeNull();
  });

  it("sudo with only reading commands is not critical, here or on another machine through ssh", () => {
    for (const command of [
      "sudo cat /docker/portal/app/server.py",
      "sudo ls -la /root/backups",
      "sudo grep -rn agendar_para /docker/portal/app",
      "sudo head -50 /docker/portal/app/server.py",
      "sudo tail -n 100 /var/log/syslog 2>/dev/null",
      "sudo systemctl status nordus --no-pager",
      "sudo -u portal cat /home/portal/.env.exemplo",
      "ssh -F /home/nordus/.programador/ssh_config portal-vps 'sudo cat /docker/portal/app/server.py | grep -n pendentes'",
      'ssh hermes "sudo ls /docker/portal/app && sudo grep -c def /docker/portal/app/server.py" 2>&1 | head',
      'S="ssh -F /home/nordus/.programador/ssh_config portal-vps"; $S \'sudo cat /docker/portal/app/server.py\' | head -200',
    ]) expect(criticalCommand(command), command).toBeNull();
  });

  it("tricks the review found stay critical: option values, repo config, hidden flags, hidden sudo", () => {
    for (const command of [
      "sudo systemctl -p status stop nginx",
      "sudo systemctl -p status link /home/nordus/evil.service",
      "sudo docker --config ps run --privileged -v /:/h alpine chroot /h id",
      "sudo git -C /home/nordus/repo diff",
      "sudo git log -p",
      "sudo find /etc/hostname -maxdepth 0 '-exec' /bin/chmod 4755 /bin/bash ';'",
      "sudo find /etc/hostname -maxdepth 0 -\\exec /bin/chmod 4755 /bin/bash \\;",
      "X='-exec /bin/chmod 4755 /bin/bash ;'; sudo find /etc/hostname $X",
      "sudo find /etc/hostname {-exec,} /bin/chmod 4755 /bin/bash \\;",
      "sudo find /etc/hostname -maxdepth 0 \\\n -exec /bin/chmod 4755 /bin/bash \\;",
      "\\sudo chmod 4755 /bin/bash",
      "S=sudo; $S chmod 4755 /bin/bash",
      "sudo cat /etc/*",
      "sudo journalctl --vacuum-size=1",
    ]) expect(criticalCommand(command), command).not.toBeNull();
  });

  it("ASSISTENTEFINANCEIRO's sender counts as a send however the subcommand is written", () => {
    for (const command of ["enviar-email -- enviar r1 --para a@b.com", "enviar-email $'enviar' r1 --para a@b.com", "enviar-email \"enviar\" r1"]) {
      expect(criticalCommand(command), command).toBe("send");
    }
  });

  it("sudo stays critical for anything but reading, and a command run through ssh is read like a local one", () => {
    const still = [
      "sudo cat x > y",
      "sudo cat x >> /etc/hosts",
      "sudo tee /etc/sudoers.d/x",
      "echo a | sudo tee /etc/x",
      'sudo bash -c "rm -rf /x"',
      "sudo cat a; sudo rm b",
      "sudo cat a && sudo cp a /etc/b",
      "sudo cat x | sh",
      "sudo cat $(echo /etc/shadow)",
      "sudo cat `echo x`",
      "sudo find / -name x -delete",
      "sudo find / -name x -exec rm {} \\;",
      "sudo sed -i s/a/b/ /etc/x",
      "sudo chmod 600 /etc/x",
      "sudo mv a b",
      "sudo docker exec portal sh",
      "sudo docker rm portal",
      "sudo systemctl stop nginx",
      "sudo journalctl --vacuum-time=1d",
      "sudo git -C /x diff --output=/etc/x",
      "sudo git -C /x checkout main",
      "sudo -i",
      "sudo -s",
      "sudo -u root bash",
      "sudo LD_PRELOAD=/tmp/x.so cat y",
      "sudo rg --pre ./x.sh pattern /",
      'ssh h "sudo rm -rf /x"',
      "ssh h 'sudo cp a /etc/b'",
      "ssh -F /home/nordus/.programador/ssh_config portal-vps 'sudo portalctl exec prod sh -c \"ls\"'",
      'S="ssh portal-vps"; $S \'sudo rm -rf /x\'',
      "ssh h 'sudo cat a > /etc/b'",
    ];
    for (const command of still) expect(criticalCommand(command), command).not.toBeNull();
    expect(criticalCommand('ssh h "sudo rm -rf /x"')).toBe("delete");
    expect(criticalCommand("ssh h 'rm -rf /srv/x'"), "a remote delete is a delete even without sudo").toBe("delete");
  });

  it("lets a program word that is only a name, a path, a check or written data through", () => {
    const noise = [
      "cd /home/nordus/zorg/bots/programador/release-sudo && ls -la && for f in *; do echo \"=== $f\"; cat \"$f\"; done",
      "ls -la /home/nordus/release/ 2>&1; echo ---; stat -c '%U:%G %a %n' /home/nordus /home/nordus/release 2>&1; echo ---; id; getent group sudo; id ubuntu 2>&1",
      'sudo -n true 2>&1 | head -1; echo "sudo rc=$?"',
      "cd /home/nordus/zorg/bots/programador/release-sudo && sha256sum aplicar.sh nordus-release roteiros/*.sh && /usr/sbin/visudo -cf nordus-release && ls -la",
      "cat > aplicar.sh.modelo <<'EOF'\n#!/bin/bash\nsudo -n visudo -f /etc/sudoers.d/x\nsudo ufw disable\nEOF",
      "cat > aplicar.sh.modelo <<'EOF'\n#!/bin/bash\nsudo ufw disable\nvisudo\nEOF\n",
      "cat >> notes/aplicar.md <<\"END\"\nsudo reboot\nEND",
      "tee -a notes.md <<EOF\nrun sudo apt update\nEOF",
      "tee notes.md <<EOF >/dev/null\nrun sudo apt update\nEOF",
      "cat <<-'EOF' > nota.txt\n\tsudo reboot\n\t\tEOF",
      "cat /etc/passwd",
      "grep sudo /etc/group",
      "grep -rn sudo /home/nordus/zorg | head",
      "getent group sudo",
      "sudo -l",
      "sudo -v",
      "sudo -k",
      "sudo -K",
      "sudo -n -l",
      "sudo -nl",
      "sudo --list",
      "sudo --validate",
      "sudo -n true",
      "sudo -nS true",
      "sudo -n :",
      "sudo -n true && echo ok",
      "(sudo -n true)",
      "visudo -c",
      "visudo --check -f x",
      "visudo -f x -c",
      "visudo -qcf /etc/sudoers",
      "ls virada-sudo/roteiros sudo.conf",
    ];
    for (const command of noise) expect(criticalCommand(command), command).toBeNull();
    expect(criticalAction("Bash", "sudo -n true")).toBeNull();
  });

  it("does not card cleaning a work copy or /tmp, nor reading the firewall", () => {
    const harmless = [
      "python3 - <<'EOF'\nimport re\nprint('ok')\nEOF\nsed -i 's#a#b#' scene/index.html\nrm -rf assets/fotos assets/telas assets/audio/trilha.wav assets/audio/voz.wav\nls assets",
      "rm -rf /tmp/ce-site-ZRWb && echo apagado",
      "cd /tmp && rm -rf eco-bk && mkdir eco-bk && cd eco-bk && gh api repos/x/y",
      "cd /tmp && rm -rf /tmp/wb && mkdir -p /tmp/wb",
      "rm -rf /tmp/handoff-1910",
      "systemctl is-active ufw 2>/dev/null; ls /etc/ufw/user.rules",
      "iptables -L -n",
      "ufw status",
      "ufw status verbose",
      "iptables -S",
      "nft list ruleset",
      "firewall-cmd --list-all",
      "rm -rf build dist/ .cache",
      "rm -fr /var/tmp/x",
      "rm --recursive --force out/old",
    ];
    for (const command of harmless) expect(criticalCommand(command), command).toBeNull();
  });

  it("still waits for a delete that can reach beyond the work copy, and for a firewall change", () => {
    const deletes = [
      "rm -rf /",
      "rm -rf ~",
      "rm -rf ~/x",
      "rm -rf $HOME/x",
      "rm -rf /home/nordus/zorg",
      "rm -rf ../x",
      "rm -rf a/../../x",
      "rm -rf *",
      "rm -rf /tmp",
      "rm -rf /tmp/",
      "rm -rf /tmp/../etc",
      "rm -rf .",
      "rm -rf ./",
      "rm -rf",
      'rm -rf "$D"',
      "rm -rf $(pwd)",
      "rm -rf `pwd`",
      "cd /tmp && rm -rf /etc/x",
      "rm -rf a /etc",
      "rm -rf --no-preserve-root /tmp/x",
      "rm -r -f /var/lib/x",
      "ls | xargs rm -rf",
      "find . -exec rm -rf {} \\;",
    ];
    for (const command of deletes) expect(criticalCommand(command), command).toBe("delete");
    const firewall = [
      "ufw allow 22",
      "sudo ufw status numbered && ufw delete 3",
      "iptables -F",
      "iptables -t nat -A POSTROUTING -j MASQUERADE",
      "ip6tables --flush",
      "iptables-restore < rules.v4",
      "nft flush ruleset",
      "nft -f /etc/nftables.conf",
      "firewall-cmd --permanent --add-port=80/tcp",
      "/usr/sbin/ufw --force enable",
    ];
    for (const command of firewall) expect(criticalCommand(command), command).toBe("config");
  });

  it("expands only a variable the command sets once to a plain path", () => {
    const real = [
      "cd /home/nordus/zorg/qg-design/bots/diretor-de-arte; P=entregas/lumon/2026-10-20-carrossel-piscinas; rm -rf entregas/lumon/tmp-piscinas-l5 $P/revisao/v7",
      'node ferramentas/exportar-figma/exportar-figma.js png --arquivo fL6 --quadros 165:390 --modo revisao --pedido "$P" 2>&1 | tail -1',
      'V=$P/revisao/v7; file $V/*.png | cut -d, -f1,2',
    ];
    expect(criticalCommand(real.join("\n")), "the real design command").toBeNull();
    for (const command of ["P=a; rm -rf ${P}/x", "P='a/b'; rm -rf $P", 'P="a/b"; rm -rf $P/c', "P=/tmp/x; rm -rf $P"]) {
      expect(criticalCommand(command), command).toBeNull();
    }
    const stillCritical = [
      "P=/home/nordus; rm -rf $P",
      "P=..; rm -rf $P/x",
      "P=a; P=/; rm -rf $P",
      "rm -rf $P; P=a",
      "P=a rm -rf $P",
      "read P; rm -rf $P",
      "for P in /; do rm -rf $P; done",
      "P=a; rm -rf ${P:-/}",
      "P=a; export P=/etc; rm -rf $P",
      "P=$HOME; rm -rf $P",
      'P="a b"; rm -rf $P',
      "P=a; rm -rf $P/../..",
      "P='*'; rm -rf $P",
      "false && P=a; rm -rf $P/x",
      "(P=a); rm -rf $P",
      "echo 'x; P=a'; rm -rf $P",
      "echo hi # ;P=a\nrm -rf $P",
      "P=a; P+=/..; rm -rf $P",
    ];
    for (const command of stillCritical) expect(criticalCommand(command), command).toBe("delete");
  });

  it("classifies a very large command quickly", () => {
    const dense = `python3 - <<EOF\n${"x=a<<1;".repeat(20_000)}\nEOF`;
    const source = `g++ -x c++ - <<'EOF'\n${"  std::cout << x;\n".repeat(50_000)}EOF`;
    for (const command of [dense, source]) {
      const started = performance.now();
      expect(criticalCommand(command)).toBeNull();
      expect(performance.now() - started).toBeLessThan(100);
    }
  });
});
