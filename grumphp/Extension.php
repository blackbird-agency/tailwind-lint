<?php

declare(strict_types=1);

namespace Blackbird\TailwindLint\GrumPHP;

use GrumPHP\Extension\ExtensionInterface;

class Extension implements ExtensionInterface
{
    public function imports(): iterable
    {
        yield __DIR__ . '/services.yaml';
    }
}
