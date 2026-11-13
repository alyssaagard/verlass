/**
 * Builds the Outlook add-in manifest (the XML "add-in only" manifest, which the Microsoft 365
 * admin center accepts for central deployment and which works in Outlook on the web, Windows,
 * Mac, iOS, and Android).
 *
 * The same function is used by `npm run build` for the generic manifest and by the install
 * page, which makes a manifest carrying an organization's own connection settings.
 *
 * The add-in asks Outlook only for ReadItem: it can read the message that is open (to turn it
 * into a ticket) and nothing else in the mailbox.
 */
import { configQuery } from "../hosts/config.js";

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * info: { name, siteUrl, addinId, version, provider, description }
 * config: connection settings from checkConfig, or null for a manifest without them.
 */
export function outlookManifest(info, config) {
  const site = String(info.siteUrl).replace(/\/+$/, "");
  const pane = site + "/app/outlook.html" + (config ? "?" + configQuery(config) : "");
  const icon = (size) => `${site}/assets/icons/icon-${size}.png`;
  const version = String(info.version).split(".").concat(["0", "0", "0", "0"]).slice(0, 4).join(".");
  const id = info.name.replace(/[^A-Za-z0-9]/g, "");
  const tip = "Send a request to the help desk, follow your requests, and work the team's queue.";

  const button = (pin) => `<Control xsi:type="Button" id="${id}Open">
                  <Label resid="ButtonLabel"/>
                  <Supertip>
                    <Title resid="ButtonLabel"/>
                    <Description resid="ButtonTip"/>
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="Icon.16"/>
                    <bt:Image size="32" resid="Icon.32"/>
                    <bt:Image size="80" resid="Icon.80"/>
                  </Icon>
                  <Action xsi:type="ShowTaskpane">
                    <SourceLocation resid="Taskpane.Url"/>${pin ? "\n                    <SupportsPinning>true</SupportsPinning>" : ""}
                  </Action>
                </Control>`;

  const desktop = (pin) => `<DesktopFormFactor>
          <ExtensionPoint xsi:type="MessageReadCommandSurface">
            <OfficeTab id="TabDefault">
              <Group id="${id}Group">
                <Label resid="GroupLabel"/>
                ${button(pin)}
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>`;

  const mobileSizes = [
    [25, 1, 25], [25, 2, 50], [25, 3, 75],
    [32, 1, 32], [32, 2, 64], [32, 3, 96],
    [48, 1, 48], [48, 2, 96], [48, 3, 144],
  ];
  const mobile = `<MobileFormFactor>
          <ExtensionPoint xsi:type="MobileMessageReadCommandSurface">
            <Group id="${id}MobileGroup">
              <Label resid="GroupLabel"/>
              <Control xsi:type="MobileButton" id="${id}MobileOpen">
                <Label resid="ButtonLabel"/>
                <Icon xsi:type="bt:MobileIconList">
                  ${mobileSizes.map(([size, scale, px]) => `<bt:Image size="${size}" scale="${scale}" resid="Icon.${px}"/>`).join("\n                  ")}
                </Icon>
                <Action xsi:type="ShowTaskpane">
                  <SourceLocation resid="Taskpane.Url"/>
                </Action>
              </Control>
            </Group>
          </ExtensionPoint>
        </MobileFormFactor>`;

  const resources = (sizes) => `<Resources>
      <bt:Images>
        ${sizes.map((px) => `<bt:Image id="Icon.${px}" DefaultValue="${icon(px)}"/>`).join("\n        ")}
      </bt:Images>
      <bt:Urls>
        <bt:Url id="Taskpane.Url" DefaultValue="${xml(pane)}"/>
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="GroupLabel" DefaultValue="${xml(info.name)}"/>
        <bt:String id="ButtonLabel" DefaultValue="Help desk"/>
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="ButtonTip" DefaultValue="${xml(tip)}"/>
      </bt:LongStrings>
    </Resources>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${xml(info.name)} for Microsoft Outlook. By ${xml(info.provider)}. ${site} -->
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0"
  xsi:type="MailApp">
  <Id>${xml(info.addinId)}</Id>
  <Version>${xml(version)}</Version>
  <ProviderName>${xml(info.provider)}</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="${xml(info.name)}"/>
  <Description DefaultValue="${xml(String(info.description).slice(0, 250))}"/>
  <IconUrl DefaultValue="${icon(64)}"/>
  <HighResolutionIconUrl DefaultValue="${icon(128)}"/>
  <SupportUrl DefaultValue="${site}/help/"/>
  <AppDomains>
    <AppDomain>${site}</AppDomain>
    <AppDomain>https://login.microsoftonline.com</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Mailbox"/>
  </Hosts>
  <Requirements>
    <Sets>
      <Set Name="Mailbox" MinVersion="1.3"/>
    </Sets>
  </Requirements>
  <FormSettings>
    <Form xsi:type="ItemRead">
      <DesktopSettings>
        <SourceLocation DefaultValue="${xml(pane)}"/>
        <RequestedHeight>450</RequestedHeight>
      </DesktopSettings>
    </Form>
  </FormSettings>
  <Permissions>ReadItem</Permissions>
  <Rule xsi:type="RuleCollection" Mode="Or">
    <Rule xsi:type="ItemIs" ItemType="Message" FormType="Read"/>
  </Rule>
  <DisableEntityHighlighting>false</DisableEntityHighlighting>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Requirements>
      <bt:Sets DefaultMinVersion="1.3">
        <bt:Set Name="Mailbox"/>
      </bt:Sets>
    </Requirements>
    <Hosts>
      <Host xsi:type="MailHost">
        ${desktop(false)}
      </Host>
    </Hosts>
    ${resources([16, 32, 80])}
    <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides/1.1" xsi:type="VersionOverridesV1_1">
      <Requirements>
        <bt:Sets DefaultMinVersion="1.3">
          <bt:Set Name="Mailbox"/>
        </bt:Sets>
      </Requirements>
      <Hosts>
        <Host xsi:type="MailHost">
        ${desktop(true)}
        ${mobile}
        </Host>
      </Hosts>
    ${resources([16, 32, 80, 25, 50, 75, 64, 96, 48, 144])}
    </VersionOverrides>
  </VersionOverrides>
</OfficeApp>
`;
}
