import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

export const acceptanceOverlay = { services: { postgres: { restart: "no" }, n8n: { restart: "no" }, "bridge-db": { restart: "no" }, rabbitmq: { restart: "no", volumes: ["rabbit_test_data:/var/lib/rabbitmq"] } }, volumes: { rabbit_test_data: {} } };

export function verifyIsolation(project, compose, env, running = false, docker = (...args) => execFileSync("docker", args, { env, encoding: "utf8" }).trim()) {
  assert.match(project, /^space-agent-n8n04-acceptance-[a-f0-9]{12}$/);
  const config = JSON.parse(compose("config", "--format", "json"));
  assert.equal(config.name, project);
  assert.deepEqual(Object.keys(config.services).sort(), ["bridge-db", "n8n", "postgres", "rabbitmq"]);
  for (const volume of Object.values(config.volumes)) { assert(!volume.external); assert(volume.name.startsWith(project + "_")); }
  for (const network of Object.values(config.networks)) { assert(!network.external); assert(network.name.startsWith(project + "_")); }
  for (const service of Object.values(config.services)) {
    assert.equal(service.restart, "no");
    assert(!service.container_name && !service.network_mode && !service.privileged);
    assert(service.image.includes("@sha256:"));
    for (const port of service.ports ?? []) assert.equal(port.host_ip, "127.0.0.1");
    for (const mount of service.volumes ?? []) {
      if (mount.type === "bind") {
        assert.equal(path.resolve(mount.source), path.resolve("infra/n8n/init.sql"));
        assert.equal(mount.read_only, true);
      } else { assert.equal(mount.type, "volume"); assert(config.volumes[mount.source]); }
    }
    for (const network of Object.keys(service.networks)) assert(config.networks[network]);
  }
  const ids = docker("ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`).split(/\s+/).filter(Boolean);
  if (!running) {
    assert.equal(ids.length, 0, "project already exists");
    for (const [type, definitions] of [["volume", config.volumes], ["network", config.networks]]) {
      const names = docker(type, "ls", "--format", "{{.Name}}").split(/\r?\n/);
      for (const definition of Object.values(definitions)) assert(!names.includes(definition.name), "resource already exists");
    }
  } else {
    assert.equal(ids.length, 4);
    const containers = JSON.parse(docker("inspect", ...ids));
    const seen = new Set();
    for (const container of containers) {
      assert.equal(container.Config.Labels["com.docker.compose.project"], project);
      const serviceName = container.Config.Labels["com.docker.compose.service"];
      const service = config.services[serviceName];
      assert(service && !seen.has(serviceName), "unknown or duplicate service"); seen.add(serviceName);
      assert.deepEqual(Object.keys(container.NetworkSettings.Networks).sort(), Object.keys(service.networks).map(n => config.networks[n].name).sort());
      const expectedMounts = (service.volumes ?? []).map(m => [m.type, m.type === "volume" ? config.volumes[m.source].name : "init.sql", m.target, !m.read_only]);
      const actualMounts = container.Mounts.map(m => [m.Type, m.Type === "volume" ? m.Name : "init.sql", m.Destination, m.RW]);
      const ordered = rows => rows.map(row => JSON.stringify(row)).sort();
      assert.deepEqual(ordered(actualMounts), ordered(expectedMounts), `mount mismatch: ${serviceName}`);
      for (const network of Object.keys(container.NetworkSettings.Networks)) assert(Object.values(config.networks).some(n => n.name === network));
      for (const mount of container.Mounts) {
        if (mount.Type === "volume") assert(Object.values(config.volumes).some(v => v.name === mount.Name));
        else {
          const normalized = mount.Source.replace(/^\/(?:run\/desktop\/mnt\/host|host_mnt)\/([a-z])\//i, "$1:/");
          assert.equal(path.resolve(normalized).toLowerCase(), path.resolve("infra/n8n/init.sql").toLowerCase());
          assert.equal(mount.Destination, "/docker-entrypoint-initdb.d/01-n8n.sql"); assert.equal(mount.RW, false);
        }
      }
    }
  }
  return { status: "PASS", project, stage: running ? "actual-mounts-before-import" : "resolved-config-and-resource-absence", volumes: Object.values(config.volumes).map(v => v.name), networks: Object.values(config.networks).map(n => n.name) };
}
