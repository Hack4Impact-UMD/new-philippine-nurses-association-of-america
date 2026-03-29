import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/shared/page-header";

export default function AboutPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="About PNAA"
        description="Philippine Nurses Association of America"
      />

      <Card>
        <CardHeader>
          <CardTitle>Our Mission</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            The Philippine Nurses Association of America (PNAA) is a professional organization representing Filipino-American nurses across the United States. Established in 1979, PNAA is committed to advancing the professional growth, leadership, and well-being of its members while promoting excellence in nursing practice, education, research, and community service.

          </p>
          <p>
            PNAA serves as a unified voice for over 4000 Filipino-American nurses across 55 chapters, advocating for health equity and 
            supporting initiatives that improve healthcare outcomes both nationally and globally. 
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Our Vision</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            To be the premier professional nursing organization that empowers Filipino-American nurses to lead, 
            innovate, and advance healthcare in the United States and around the world.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Our Impact</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
           PNAA connects a national network of over 4,000 nurses across 50+ chapters, fostering:

          Professional development and leadership opportunities
          Community outreach and public health initiatives
          Cultural preservation and collaboration within the Filipino-American community

          Through its chapters and national programs, PNAA continues to make meaningful contributions to healthcare delivery and advocacy.
          </p>

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Regions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            {[
              "Northeast Region",
              "Southeast Region",
              "Central Region",
              "Western Region",
              "Mid-Atlantic Region",
              "Southern Region",
            ].map((region) => (
              <div
                key={region}
                className="flex items-center gap-2 rounded-md border p-3"
              >
                <div className="h-2 w-2 rounded-full bg-primary" />
                <span>{region}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="space-y-3">
            <div className="flex gap-4">
              <span className="font-semibold text-foreground min-w-[4rem]">
                1979
              </span>
              <p>PNAA was founded to unite Filipino-American nurses</p>
            </div>
            <Separator />
            <div className="flex gap-4">
              <span className="font-semibold text-foreground min-w-[4rem]">
                Today
              </span>
              <p>
                Over 4,000 members across 55 chapters serve communities
                throughout the United States
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chapter Management Platform</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            The PNAA Chapter Management Platform is designed to centralize and streamline operations across chapters and the national organization.   
            Member and event data are integrated from Wild Apricot, while fundraising and custom content are managed directly within the platform—providing a comprehensive, real-time view at both the chapter and national levels.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
